const MetaConnection = require('../models/MetaConnection');
const MetaWebhookEvent = require('../models/MetaWebhookEvent');
const Lead = require('../models/Lead');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { ROLES } = require('../constants/roles');
const { decrypt } = require('../utils/crypto');
const metaService = require('./metaService');
const { broadcastToOrganization } = require('./realtimeService');

/**
 * Collision-proof sequential lead code generator within tenant organization
 */
const generateLeadCode = async (organizationId) => {
  const year = new Date().getFullYear();
  const prefix = `EF-LD-${year}-`;

  // Find the lead with the highest sequence number for this year and org
  const latestLead = await Lead.findOne({
    organizationId,
    leadCode: new RegExp(`^${prefix}\\d+$`),
  })
    .sort({ leadCode: -1 })
    .select('leadCode')
    .lean();

  let nextSeq = 1;
  if (latestLead && latestLead.leadCode) {
    const parts = latestLead.leadCode.split('-');
    const currentSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  // Ensure collision safety in case of deleted gaps or race conditions
  let candidate = `${prefix}${String(nextSeq).padStart(4, '0')}`;
  while (await Lead.exists({ organizationId, leadCode: candidate })) {
    nextSeq += 1;
    candidate = `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  return candidate;
};

/**
 * Process single leadgen change entry received from Meta Lead Ads Webhook
 */
const processWebhookLeadgenEntry = async ({ pageId, formId, leadgenId, createdTime, adId, eventId }) => {
  if (!pageId || !leadgenId) {
    console.warn('[MetaSync] Skipping invalid entry without pageId or leadgenId');
    return null;
  }

  // 1. Check idempotency: avoid processing duplicate webhooks
  let eventRecord = await MetaWebhookEvent.findOne({ pageId, leadgenId });
  if (eventRecord && ['PROCESSED', 'PROCESSING'].includes(eventRecord.status)) {
    console.log(`[MetaSync] Idempotent skip: Lead ${leadgenId} on page ${pageId} already ${eventRecord.status}`);
    return { skipped: true, reason: 'Already processed' };
  }

  if (!eventRecord) {
    eventRecord = await MetaWebhookEvent.create({
      pageId,
      formId: formId || '',
      leadgenId,
      adId: adId || '',
      eventId: eventId || `ev_${leadgenId}_${Date.now()}`,
      status: 'PROCESSING',
      receivedAt: new Date(),
    });
  } else {
    eventRecord.status = 'PROCESSING';
    eventRecord.attemptCount += 1;
    await eventRecord.save();
  }

  try {
    // 2. Find matching MetaConnection for this Facebook Page
    const connection = await MetaConnection.findOne({
      'selectedPages.pageId': pageId,
      status: { $ne: 'DISCONNECTED' },
    }).select('+selectedPages.encryptedPageAccessToken');

    if (!connection) {
      const msg = `No active Meta integration found for Facebook Page ID ${pageId}`;
      console.warn(`[MetaSync] ${msg}`);
      eventRecord.status = 'FAILED';
      eventRecord.errorMessage = msg;
      await eventRecord.save();
      return null;
    }

    eventRecord.organizationId = connection.organizationId;
    await eventRecord.save();

    // 3. Locate page and decrypt Page Access Token
    const pageConfig = connection.selectedPages.find((p) => p.pageId === pageId);
    if (!pageConfig || !pageConfig.encryptedPageAccessToken) {
      throw new Error(`Page Access Token not found for page ${pageId}`);
    }

    const pageAccessToken = decrypt(pageConfig.encryptedPageAccessToken);
    if (!pageAccessToken) {
      throw new Error(`Failed to decrypt Page Access Token for page ${pageId}`);
    }

    // 4. Fetch actual lead details from Meta Graph API
    console.log(`[MetaSync] Fetching lead details from Meta Graph API for leadgen_id: ${leadgenId}`);
    const rawLead = await metaService.getLeadDetails(leadgenId, pageAccessToken);

    // 5. Parse and normalize lead attributes
    const parsed = metaService.parseLeadData(rawLead);

    // Enrich with Page and Form names from config if available
    const pageName = pageConfig.pageName || parsed.metaPageName || 'Facebook Page';
    let formName = parsed.metaFormName || '';
    if (!formName && formId && pageConfig.forms) {
      const matchedForm = pageConfig.forms.find((f) => f.formId === formId);
      if (matchedForm) formName = matchedForm.formName;
    }
    if (!formName && parsed.metaFormId && pageConfig.forms) {
      const matchedForm = pageConfig.forms.find((f) => f.formId === parsed.metaFormId);
      if (matchedForm) formName = matchedForm.formName;
    }

    parsed.metaPageId = pageId;
    parsed.metaPageName = pageName;
    parsed.metaFormName = formName || 'Lead Ad Form';

    // 6. Check if lead already exists in CRM by metaLeadId or phone
    const targetMetaLeadId = parsed.metaLeadId ? String(parsed.metaLeadId).trim() : String(leadgenId).trim();

    let lead = await Lead.findOne({
      organizationId: connection.organizationId,
      metaLeadId: targetMetaLeadId,
    });

    if (!lead && parsed.phone && parsed.phone !== 'N/A') {
      lead = await Lead.findOne({
        organizationId: connection.organizationId,
        phone: parsed.phone,
      });
    }

    let isNewlyCreated = false;

    if (!lead) {
      // Pick default sales assignee (or owner/first employee)
      let defaultAssignee = null;
      const salesExecutive = await User.findOne({
        organizationId: connection.organizationId,
        role: ROLES.EMPLOYEE,
        isActive: true,
      }).select('_id');

      if (salesExecutive) {
        defaultAssignee = salesExecutive._id;
      } else {
        const owner = await User.findOne({
          organizationId: connection.organizationId,
          role: ROLES.OWNER,
        }).select('_id');
        if (owner) defaultAssignee = owner._id;
      }

      const leadCode = await generateLeadCode(connection.organizationId);

      try {
        lead = await Lead.create({
          organizationId: connection.organizationId,
          leadCode,
          name: parsed.name,
          phone: parsed.phone,
          email: parsed.email,
          preferredLocation: parsed.preferredLocation,
          preferredPropertyType: parsed.preferredPropertyType,
          budgetMin: parsed.budgetMin,
          budgetMax: parsed.budgetMax,
          source: 'Meta Lead Ads',
          priority: 'High',
          status: 'New',
          assignedTo: defaultAssignee,
          metaLeadId: targetMetaLeadId,
        metaPageId: parsed.metaPageId,
        metaPageName: parsed.metaPageName,
        metaFormId: parsed.metaFormId,
        metaFormName: parsed.metaFormName,
        metaCampaignId: parsed.metaCampaignId,
        metaCampaignName: parsed.metaCampaignName,
        metaAdSetId: parsed.metaAdSetId,
        metaAdSetName: parsed.metaAdSetName,
        metaAdId: parsed.metaAdId,
        metaAdName: parsed.metaAdName,
        metaPlatform: parsed.metaPlatform,
        formAnswers: parsed.formAnswers,
        metaRawData: parsed.metaRawData,
        metaCreatedAt: parsed.metaCreatedAt,
        isNewLead: true,
        syncSource: 'WEBHOOK',
        syncStatus: 'SUCCESS',
        history: [
          {
            action: 'Lead Received from Meta Lead Ads',
            note: `Auto-captured via webhook from Page "${pageName}" (Campaign: ${parsed.metaCampaignName || 'Organic'})`,
            performedBy: connection.connectedBy,
            newStatus: 'New',
            timestamp: new Date(),
          },
        ],
        });

        isNewlyCreated = true;
      } catch (createErr) {
        if (createErr.code === 11000) {
          console.warn(`[MetaWebhook] Handled duplicate key for lead ${targetMetaLeadId}:`, createErr.keyValue || createErr.message);
          lead = await Lead.findOne({
            organizationId: connection.organizationId,
            metaLeadId: targetMetaLeadId,
          });
          if (lead) {
            lead.metaCampaignName = parsed.metaCampaignName || lead.metaCampaignName;
            lead.metaAdName = parsed.metaAdName || lead.metaAdName;
            lead.formAnswers = parsed.formAnswers.length > 0 ? parsed.formAnswers : lead.formAnswers;
            await lead.save();
          }
        } else {
          throw createErr;
        }
      }

      if (isNewlyCreated && lead) {
        // 7. Dispatch in-app notification to assigned user and admins
      const notifyRecipients = await User.find({
        organizationId: connection.organizationId,
        $or: [{ _id: defaultAssignee }, { role: { $in: [ROLES.OWNER, ROLES.ADMIN] } }],
        isActive: true,
      }).select('_id email');

      for (const recipient of notifyRecipients) {
        await Notification.create({
          organizationId: connection.organizationId,
          recipientId: recipient._id,
          title: `New Meta Lead: ${lead.name}`,
          message: `Received via Meta Lead Ads form "${parsed.metaFormName}" (${lead.phone})`,
          type: 'system_alert',
          linkUrl: `/leads?id=${lead._id}`,
          metadata: {
            leadId: lead._id,
            metaLeadId: parsed.metaLeadId,
            source: 'Meta Lead Ads',
          },
        });
      }

        console.log(`[MetaSync] Successfully created Lead ${lead.leadCode} (${lead.name})`);
      }
    } else {
      // Update existing record with latest campaign / form answers
      lead.metaCampaignName = parsed.metaCampaignName || lead.metaCampaignName;
      lead.metaAdName = parsed.metaAdName || lead.metaAdName;
      lead.formAnswers = parsed.formAnswers.length > 0 ? parsed.formAnswers : lead.formAnswers;
      await lead.save();
      console.log(`[MetaSync] Updated existing lead record ${lead.leadCode}`);
    }

    // 8. Update Webhook Event status
    eventRecord.status = 'PROCESSED';
    eventRecord.processedAt = new Date();
    eventRecord.errorMessage = '';
    await eventRecord.save();

    // 9. Update Connection metrics
    connection.lastSyncAt = new Date();
    connection.lastSyncStatus = 'SUCCESS';
    connection.lastSyncMessage = `Synchronized lead ${lead.name} via webhook`;
    if (isNewlyCreated) {
      connection.totalLeadsImported = (connection.totalLeadsImported || 0) + 1;
    }
    await connection.save();

    // 10. Broadcast Real-time SSE event to all connected CRM clients in this org
    broadcastToOrganization(connection.organizationId, 'new_lead', {
      lead: {
        _id: lead._id,
        leadCode: lead.leadCode,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        status: lead.status,
        priority: lead.priority,
        source: lead.source,
        metaCampaignName: lead.metaCampaignName,
        metaPageName: lead.metaPageName,
        metaFormName: lead.metaFormName,
        isNewLead: lead.isNewLead,
        createdAt: lead.createdAt,
        metaCreatedAt: lead.metaCreatedAt,
      },
      message: `New Lead: ${lead.name} from Meta Lead Ads`,
    });

    return { success: true, lead, isNewlyCreated };
  } catch (err) {
    console.error(`[MetaSync] Error processing leadgen entry ${leadgenId}:`, err);
    eventRecord.status = 'FAILED';
    eventRecord.errorMessage = err.message;
    await eventRecord.save();
    throw err;
  }
};

/**
 * Synchronize / Import existing historical leads from a Meta Form
 */
const syncFormLeads = async (organizationId, formId, limit = 50) => {
  const connection = await MetaConnection.findOne({
    organizationId,
    status: { $ne: 'DISCONNECTED' },
  }).select('+selectedPages.encryptedPageAccessToken');

  if (!connection) {
    throw new Error('No active Meta connection found for this organization');
  }

  // Find page that contains this form
  let targetPage = null;
  let formMeta = null;

  for (const page of connection.selectedPages) {
    if (page.forms && page.forms.some((f) => f.formId === formId)) {
      targetPage = page;
      formMeta = page.forms.find((f) => f.formId === formId);
      break;
    }
  }

  // If not found in forms array, use first active page with token
  if (!targetPage && connection.selectedPages.length > 0) {
    targetPage = connection.selectedPages[0];
  }

  if (!targetPage) {
    throw new Error('No Facebook Page configured for lead synchronization');
  }

  const pageAccessToken = decrypt(targetPage.encryptedPageAccessToken);
  if (!pageAccessToken) {
    throw new Error('Unable to decrypt Page Access Token for Meta synchronization');
  }

  console.log(`[MetaSync] Fetching leads for form ${formId} from Meta Graph API...`);
  const rawLeads = await metaService.getFormLeads(formId, pageAccessToken, limit);

  let newlyCreated = 0;
  let existingUpdated = 0;

  for (const rawLead of rawLeads) {
    try {
      const parsed = metaService.parseLeadData(rawLead);
      parsed.metaPageId = targetPage.pageId;
      parsed.metaPageName = targetPage.pageName;
      parsed.metaFormName = formMeta?.formName || 'Lead Form';

      const leadIdStr = parsed.metaLeadId ? String(parsed.metaLeadId).trim() : null;

      // 1. Check if lead already exists in CRM by metaLeadId
      let lead = null;
      if (leadIdStr) {
        lead = await Lead.findOne({
          organizationId,
          metaLeadId: leadIdStr,
        });
      }

      // If not found by metaLeadId, also check by phone within tenant if phone is valid
      if (!lead && parsed.phone && parsed.phone !== 'N/A') {
        lead = await Lead.findOne({
          organizationId,
          phone: parsed.phone,
        });
      }

      if (!lead) {
        let createdLead = null;
        let attempts = 0;

        // Try creating lead; if leadCode or metaLeadId collision happens, handle gracefully
        while (!createdLead && attempts < 3) {
          attempts += 1;
          const leadCode = await generateLeadCode(organizationId);

          try {
            createdLead = await Lead.create({
              organizationId,
              leadCode,
              name: parsed.name,
              phone: parsed.phone,
              email: parsed.email,
              preferredLocation: parsed.preferredLocation,
              preferredPropertyType: parsed.preferredPropertyType,
              budgetMin: parsed.budgetMin,
              budgetMax: parsed.budgetMax,
              source: 'Meta Lead Ads',
              priority: 'High',
              status: 'New',
              assignedTo: connection.connectedBy,
              metaLeadId: leadIdStr,
              metaPageId: parsed.metaPageId,
              metaPageName: parsed.metaPageName,
              metaFormId: parsed.metaFormId || formId,
              metaFormName: parsed.metaFormName,
              metaCampaignId: parsed.metaCampaignId,
              metaCampaignName: parsed.metaCampaignName,
              metaAdSetId: parsed.metaAdSetId,
              metaAdSetName: parsed.metaAdSetName,
              metaAdId: parsed.metaAdId,
              metaAdName: parsed.metaAdName,
              metaPlatform: parsed.metaPlatform,
              formAnswers: parsed.formAnswers,
              metaRawData: parsed.metaRawData,
              metaCreatedAt: parsed.metaCreatedAt,
              isNewLead: true,
              syncSource: 'MANUAL_IMPORT',
              syncStatus: 'SUCCESS',
              history: [
                {
                  action: 'Lead Imported from Meta',
                  note: `Initial import from form "${parsed.metaFormName}"`,
                  performedBy: connection.connectedBy,
                  newStatus: 'New',
                  timestamp: new Date(),
                },
              ],
            });
            newlyCreated += 1;
          } catch (createErr) {
            if (createErr.code === 11000) {
              console.warn(`[MetaSync] Duplicate key detected on attempt ${attempts}:`, createErr.keyValue || createErr.message);

              // Check if another webhook or process already created the lead with this metaLeadId or phone
              let existingCollidedLead = null;
              if (leadIdStr) {
                existingCollidedLead = await Lead.findOne({ organizationId, metaLeadId: leadIdStr });
              }
              if (!existingCollidedLead && parsed.phone && parsed.phone !== 'N/A') {
                existingCollidedLead = await Lead.findOne({ organizationId, phone: parsed.phone });
              }

              if (existingCollidedLead) {
                existingCollidedLead.formAnswers = parsed.formAnswers.length > 0 ? parsed.formAnswers : existingCollidedLead.formAnswers;
                existingCollidedLead.metaCampaignName = parsed.metaCampaignName || existingCollidedLead.metaCampaignName;
                existingCollidedLead.metaAdName = parsed.metaAdName || existingCollidedLead.metaAdName;
                await existingCollidedLead.save();
                existingUpdated += 1;
                break;
              }
              // If collision was on leadCode, next iteration of while loop will pick fresh leadCode
            } else {
              throw createErr;
            }
          }
        }
      } else {
        // Update existing lead record with fresh formAnswers and campaign data
        lead.formAnswers = parsed.formAnswers.length > 0 ? parsed.formAnswers : lead.formAnswers;
        lead.metaCampaignName = parsed.metaCampaignName || lead.metaCampaignName;
        lead.metaAdName = parsed.metaAdName || lead.metaAdName;
        if (!lead.metaLeadId && leadIdStr) {
          lead.metaLeadId = leadIdStr;
        }
        await lead.save();
        existingUpdated += 1;
      }
    } catch (singleLeadErr) {
      console.error('[MetaSync] Error syncing individual lead:', singleLeadErr.message);
    }
  }

  // Update connection sync info
  connection.lastSyncAt = new Date();
  connection.lastSyncStatus = 'SUCCESS';
  connection.lastSyncMessage = `Imported ${newlyCreated} new leads (${existingUpdated} existing) from form`;
  connection.totalLeadsImported = (connection.totalLeadsImported || 0) + newlyCreated;
  await connection.save();

  // Broadcast sync event to frontend
  broadcastToOrganization(organizationId, 'leads_synced', {
    formId,
    newlyCreated,
    existingUpdated,
    totalFetched: rawLeads.length,
  });

  return {
    totalFetched: rawLeads.length,
    newlyCreated,
    existingUpdated,
  };
};

module.exports = {
  processWebhookLeadgenEntry,
  syncFormLeads,
  generateLeadCode,
};
