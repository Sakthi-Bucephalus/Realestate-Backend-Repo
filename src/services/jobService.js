const NotificationJob = require('../models/NotificationJob');
const Notification = require('../models/Notification');
const Lead = require('../models/Lead');
const SiteVisit = require('../models/SiteVisit');
const User = require('../models/User');
const Organization = require('../models/Organization');
const { sendEmail } = require('./emailService');

// Exponential backoff delays in minutes: [1, 5, 15, 60]
const BACKOFF_MINUTES = [1, 5, 15, 60];

const queueNotificationJob = async ({
  organizationId,
  recipientEmail,
  recipientName = '',
  subject,
  bodyHtml,
  bodyText = '',
  idempotencyKey,
  jobType = 'EMAIL',
}) => {
  try {
    // Check if job with this idempotency key already exists
    const existing = await NotificationJob.findOne({ idempotencyKey });
    if (existing) {
      return existing;
    }

    const job = await NotificationJob.create({
      organizationId,
      recipientEmail,
      recipientName,
      subject,
      bodyHtml,
      bodyText,
      idempotencyKey,
      jobType,
      status: 'QUEUED',
      nextRunAt: new Date(),
    });

    return job;
  } catch (err) {
    if (err.code === 11000) {
      // Duplicate idempotencyKey caught by unique index
      return await NotificationJob.findOne({ idempotencyKey });
    }
    console.error('[JobService] Error queuing job:', err.message);
    throw err;
  }
};

const processPendingNotificationJobs = async () => {
  const now = new Date();
  const jobs = await NotificationJob.find({
    status: { $in: ['QUEUED', 'RETRYING'] },
    nextRunAt: { $lte: now },
  }).limit(20);

  for (const job of jobs) {
    try {
      job.status = 'PROCESSING';
      job.attemptCount += 1;
      await job.save();

      // Retrieve organization SMTP configuration if available
      const org = await Organization.findById(job.organizationId).lean();
      const smtpConfig = org ? org.smtpConfig : null;

      await sendEmail({
        to: job.recipientEmail,
        subject: job.subject,
        html: job.bodyHtml,
        text: job.bodyText,
        smtpConfig,
      });

      job.status = 'SENT';
      job.sentAt = new Date();
      job.lastError = '';
      await job.save();
    } catch (err) {
      console.error(`[JobService] Failed delivery for job ${job._id}:`, err.message);
      job.lastError = err.message;

      if (job.attemptCount >= job.maxAttempts) {
        job.status = 'FAILED';
      } else {
        job.status = 'RETRYING';
        const delayMins = BACKOFF_MINUTES[job.attemptCount - 1] || 60;
        job.nextRunAt = new Date(Date.now() + delayMins * 60 * 1000);
      }
      await job.save();
    }
  }
};

// Check for leads whose follow-ups are due or overdue and trigger notifications
const checkDueFollowUps = async () => {
  try {
    const now = new Date();
    // Find active leads with follow-up due in next 1 hour or overdue within last 24h
    const dueLeads = await Lead.find({
      nextFollowUpDate: { $lte: new Date(now.getTime() + 60 * 60 * 1000) },
      status: { $nin: ['Converted', 'Lost'] },
      assignedTo: { $ne: null },
    })
      .populate('assignedTo', 'firstName lastName email')
      .limit(50);

    for (const lead of dueLeads) {
      if (!lead.assignedTo) continue;

      const dateStr = lead.nextFollowUpDate.toISOString().slice(0, 13); // key by hour
      const idempotencyKey = `followup-${lead._id}-${lead.assignedTo._id}-${dateStr}`;

      const isOverdue = lead.nextFollowUpDate < now;
      const title = isOverdue ? 'Follow-up Overdue' : 'Follow-up Due Soon';
      const type = isOverdue ? 'follow_up_overdue' : 'follow_up_due';

      // 1. Create in-app notification if not already created
      const existingInApp = await Notification.findOne({
        recipientId: lead.assignedTo._id,
        'metadata.leadId': lead._id,
        'metadata.followUpDate': lead.nextFollowUpDate,
      });

      if (!existingInApp) {
        await Notification.create({
          organizationId: lead.organizationId,
          recipientId: lead.assignedTo._id,
          title: `${title}: ${lead.name}`,
          message: `Lead ${lead.name} has a follow-up scheduled for ${new Date(lead.nextFollowUpDate).toLocaleString()}`,
          type,
          linkUrl: `/leads?id=${lead._id}`,
          metadata: {
            leadId: lead._id,
            followUpDate: lead.nextFollowUpDate,
          },
        });
      }

      // 2. Queue email reminder
      if (lead.assignedTo.email) {
        const emailHtml = `
          <h3>${title}: ${lead.name}</h3>
          <p>You have a follow-up scheduled with <strong>${lead.name}</strong> (${lead.phone}).</p>
          <p>Scheduled: <strong>${new Date(lead.nextFollowUpDate).toLocaleString()}</strong></p>
          <p>Remarks: ${lead.nextFollowUpRemarks || 'None'}</p>
        `;

        await queueNotificationJob({
          organizationId: lead.organizationId,
          recipientEmail: lead.assignedTo.email,
          recipientName: `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`,
          subject: `[EstateFlow] ${title}: ${lead.name}`,
          bodyHtml: emailHtml,
          bodyText: `${title} for ${lead.name} at ${new Date(lead.nextFollowUpDate).toLocaleString()}`,
          idempotencyKey,
        });
      }
    }
  } catch (err) {
    console.error('[JobService] checkDueFollowUps error:', err.message);
  }
};

// Check for upcoming site visits and dispatch reminders
const checkUpcomingSiteVisits = async () => {
  try {
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const upcomingVisits = await SiteVisit.find({
      scheduledTime: { $gte: now, $lte: in24Hours },
      status: 'Scheduled',
      'reminders.sent24h': false,
    }).populate('assignedTo propertyId');

    for (const visit of upcomingVisits) {
      if (!visit.assignedTo) continue;

      const idempotencyKey = `sitevisit-24h-${visit._id}`;

      // Create in-app notification
      await Notification.create({
        organizationId: visit.organizationId,
        recipientId: visit.assignedTo._id,
        title: `Upcoming Site Visit: ${visit.visitorName}`,
        message: `Site visit for property "${visit.propertyId?.title || 'Unit'}" is scheduled for ${new Date(visit.scheduledTime).toLocaleString()}`,
        type: 'site_visit_upcoming',
        linkUrl: `/site-visits?id=${visit._id}`,
        metadata: { visitId: visit._id },
      });

      // Mark reminder sent
      visit.reminders.sent24h = true;
      await visit.save();
    }
  } catch (err) {
    console.error('[JobService] checkUpcomingSiteVisits error:', err.message);
  }
};

// Main periodic worker function
const runPeriodicJobs = async () => {
  try {
    await processPendingNotificationJobs();
    await checkDueFollowUps();
    await checkUpcomingSiteVisits();
  } catch (err) {
    console.error('[JobService] Periodic job execution error:', err.message);
  }
};

module.exports = {
  queueNotificationJob,
  processPendingNotificationJobs,
  checkDueFollowUps,
  checkUpcomingSiteVisits,
  runPeriodicJobs,
};
