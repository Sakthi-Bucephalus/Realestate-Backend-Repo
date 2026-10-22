const SiteVisit = require('../models/SiteVisit');
const Lead = require('../models/Lead');
const Property = require('../models/Property');
const { SITE_VISIT_STATUSES, AUDIT_ACTIONS } = require('../constants/statuses');
const { ROLES } = require('../constants/roles');
const { logAudit } = require('../services/auditService');

// Helper to generate visit code
const generateVisitCode = async (organizationId) => {
  const count = await SiteVisit.countDocuments({ organizationId });
  const year = new Date().getFullYear();
  const sequence = String(count + 1).padStart(4, '0');
  return `EF-VIS-${year}-${sequence}`;
};

// 1. Get site visits (Table / Calendar format)
const getSiteVisits = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = '',
      propertyId = '',
      assignedTo = '',
      startDate = '',
      endDate = '',
      calendar = 'false',
    } = req.query;

    const query = { organizationId: req.organizationId };

    if (req.user.role === ROLES.EMPLOYEE) {
      query.assignedTo = req.user._id;
    } else if (assignedTo) {
      query.assignedTo = assignedTo;
    }

    if (status) query.status = status;
    if (propertyId) query.propertyId = propertyId;

    if (startDate || endDate) {
      query.scheduledTime = {};
      if (startDate) query.scheduledTime.$gte = new Date(startDate);
      if (endDate) query.scheduledTime.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    // Calendar mode returns unpaginated for full month view
    if (calendar === 'true') {
      const visits = await SiteVisit.find(query)
        .populate('propertyId', 'title unitNumber location propertyType')
        .populate('assignedTo', 'firstName lastName email avatar')
        .populate('leadId', 'name phone leadCode')
        .populate('customerId', 'name phone customerCode')
        .sort({ scheduledTime: 1 })
        .lean();

      return res.json({ success: true, data: visits });
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = (pageNum - 1) * limitNum;

    const [visits, total] = await Promise.all([
      SiteVisit.find(query)
        .populate('propertyId', 'title unitNumber location propertyType pricing')
        .populate('assignedTo', 'firstName lastName email department avatar')
        .populate('leadId', 'name phone leadCode')
        .populate('customerId', 'name phone customerCode')
        .sort({ scheduledTime: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      SiteVisit.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: visits,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
};

// 2. Schedule Site Visit
const createSiteVisit = async (req, res, next) => {
  try {
    const {
      leadId,
      customerId,
      visitorName,
      visitorPhone,
      propertyId,
      assignedTo,
      scheduledTime,
      meetingPoint,
      transportRequired,
    } = req.body;

    if (!propertyId || !scheduledTime || (!visitorName && !leadId && !customerId)) {
      return res.status(400).json({
        success: false,
        message: 'Property, scheduled time, and visitor information are required.',
      });
    }

    let resolvedName = visitorName;
    let resolvedPhone = visitorPhone;

    if (leadId) {
      const lead = await Lead.findById(leadId);
      if (lead) {
        resolvedName = resolvedName || lead.name;
        resolvedPhone = resolvedPhone || lead.phone;
        // Update lead status to Site Visit Scheduled
        lead.status = 'Site Visit Scheduled';
        lead.history.push({
          action: 'Site Visit Scheduled',
          note: `Site visit scheduled for ${new Date(scheduledTime).toLocaleString()}`,
          performedBy: req.user._id,
        });
        await lead.save();
      }
    }

    const visitCode = await generateVisitCode(req.organizationId);

    const siteVisit = await SiteVisit.create({
      organizationId: req.organizationId,
      visitCode,
      leadId: leadId || null,
      customerId: customerId || null,
      visitorName: resolvedName,
      visitorPhone: resolvedPhone,
      propertyId,
      assignedTo: assignedTo || req.user._id,
      scheduledTime: new Date(scheduledTime),
      meetingPoint: meetingPoint || 'Site Office',
      transportRequired: !!transportRequired,
      status: SITE_VISIT_STATUSES.SCHEDULED,
    });

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.SITE_VISIT_SCHEDULED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'SiteVisit',
      entityId: siteVisit._id,
      details: { visitCode: siteVisit.visitCode, visitorName: resolvedName },
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Site visit scheduled successfully',
      data: siteVisit,
    });
  } catch (err) {
    next(err);
  }
};

// 3. Update Site Visit / Record Outcome
const updateSiteVisit = async (req, res, next) => {
  try {
    const visit = await SiteVisit.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!visit) {
      return res.status(404).json({ success: false, message: 'Site visit not found' });
    }

    const {
      scheduledTime,
      meetingPoint,
      transportRequired,
      status,
      outcome,
      feedbackNotes,
      nextFollowUpDate,
      cancellationReason,
      assignedTo,
    } = req.body;

    if (scheduledTime) {
      visit.scheduledTime = new Date(scheduledTime);
      visit.reminders.sent24h = false;
      visit.reminders.sent2h = false;
    }
    if (meetingPoint !== undefined) visit.meetingPoint = meetingPoint;
    if (transportRequired !== undefined) visit.transportRequired = transportRequired;
    if (status) visit.status = status;
    if (outcome) visit.outcome = outcome;
    if (feedbackNotes !== undefined) visit.feedbackNotes = feedbackNotes;
    if (cancellationReason) visit.cancellationReason = cancellationReason;
    if (assignedTo) visit.assignedTo = assignedTo;

    if (nextFollowUpDate) {
      visit.nextFollowUpDate = new Date(nextFollowUpDate);
      // Also update linked lead follow up if exists
      if (visit.leadId) {
        await Lead.findByIdAndUpdate(visit.leadId, {
          nextFollowUpDate: new Date(nextFollowUpDate),
          nextFollowUpRemarks: `Post site-visit follow-up: ${feedbackNotes || ''}`,
        });
      }
    }

    await visit.save();

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.SITE_VISIT_OUTCOME,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'SiteVisit',
      entityId: visit._id,
      details: { status: visit.status, outcome: visit.outcome },
      req,
    });

    return res.json({
      success: true,
      message: 'Site visit updated successfully',
      data: visit,
    });
  } catch (err) {
    next(err);
  }
};

// 4. Cancel site visit
const cancelSiteVisit = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const visit = await SiteVisit.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!visit) {
      return res.status(404).json({ success: false, message: 'Site visit not found' });
    }

    visit.status = SITE_VISIT_STATUSES.CANCELLED;
    visit.cancellationReason = reason || 'Cancelled by agent/customer';
    await visit.save();

    return res.json({
      success: true,
      message: 'Site visit cancelled',
      data: visit,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getSiteVisits,
  createSiteVisit,
  updateSiteVisit,
  cancelSiteVisit,
};
