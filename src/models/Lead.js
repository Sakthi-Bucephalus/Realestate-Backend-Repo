const mongoose = require('mongoose');
const { LEAD_STATUSES, LEAD_PRIORITIES, LEAD_SOURCES, PROPERTY_TYPES } = require('../constants/statuses');

const LeadHistorySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
    },
    note: {
      type: String,
      default: '',
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    previousStatus: String,
    newStatus: String,
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const FollowUpSchema = new mongoose.Schema(
  {
    scheduledAt: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['Pending', 'Completed', 'Missed', 'Rescheduled'],
      default: 'Pending',
    },
    remarks: {
      type: String,
      default: '',
    },
    outcome: {
      type: String,
      default: '',
    },
    completedAt: Date,
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { _id: true, timestamps: true }
);

const CallLogSchema = new mongoose.Schema(
  {
    dialedAt: {
      type: Date,
      default: Date.now,
    },
    duration: {
      type: Number,
      default: 0,
    },
    outcome: {
      type: String,
      enum: ['Connected', 'Busy', 'No Answer', 'Left Voicemail', 'Wrong Number', 'Follow-up Scheduled'],
      default: 'Connected',
    },
    notes: {
      type: String,
      default: '',
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { _id: true, timestamps: true }
);

const FormAnswerSchema = new mongoose.Schema(
  {
    fieldName: { type: String, default: '' },
    label: { type: String, default: '' },
    value: { type: String, default: '' },
  },
  { _id: false }
);

const LeadSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    leadCode: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Lead name is required'],
      trim: true,
      maxlength: 120,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      index: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    preferredPropertyType: {
      type: String,
      enum: Object.values(PROPERTY_TYPES),
      default: PROPERTY_TYPES.RESIDENTIAL_PLOT,
    },
    preferredLocation: {
      type: String,
      trim: true,
      default: '',
    },
    budgetMin: {
      type: Number,
      default: 0,
      min: 0,
    },
    budgetMax: {
      type: Number,
      default: 0,
      min: 0,
    },
    source: {
      type: String,
      enum: LEAD_SOURCES,
      default: 'Website',
    },
    priority: {
      type: String,
      enum: Object.values(LEAD_PRIORITIES),
      default: LEAD_PRIORITIES.MEDIUM,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(LEAD_STATUSES),
      default: LEAD_STATUSES.NEW,
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      default: null,
    },
    nextFollowUpDate: {
      type: Date,
      index: true,
      default: null,
    },
    nextFollowUpRemarks: {
      type: String,
      default: '',
    },
    followUps: [FollowUpSchema],
    lastContactDate: {
      type: Date,
      default: Date.now,
    },
    convertedCustomerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    convertedBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    lostReason: {
      type: String,
      default: '',
    },
    lostNotes: {
      type: String,
      default: '',
    },
    notes: {
      type: String,
      default: '',
    },
    // Meta (Facebook / Instagram) Lead Ads Integration Fields
    metaLeadId: {
      type: String,
      trim: true,
      index: true,
      default: null,
    },
    metaPageId: {
      type: String,
      trim: true,
      default: '',
    },
    metaPageName: {
      type: String,
      trim: true,
      default: '',
    },
    metaFormId: {
      type: String,
      trim: true,
      default: '',
    },
    metaFormName: {
      type: String,
      trim: true,
      default: '',
    },
    metaCampaignId: {
      type: String,
      trim: true,
      default: '',
    },
    metaCampaignName: {
      type: String,
      trim: true,
      default: '',
    },
    metaAdSetId: {
      type: String,
      trim: true,
      default: '',
    },
    metaAdSetName: {
      type: String,
      trim: true,
      default: '',
    },
    metaAdId: {
      type: String,
      trim: true,
      default: '',
    },
    metaAdName: {
      type: String,
      trim: true,
      default: '',
    },
    metaPlatform: {
      type: String,
      trim: true,
      default: 'fb', // fb | ig
    },
    formAnswers: {
      type: [FormAnswerSchema],
      default: [],
    },
    metaRawData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    metaCreatedAt: {
      type: Date,
      default: null,
    },
    isNewLead: {
      type: Boolean,
      default: true,
      index: true,
    },
    viewedAt: {
      type: Date,
      default: null,
    },
    viewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    callLogs: {
      type: [CallLogSchema],
      default: [],
    },
    syncSource: {
      type: String,
      enum: ['WEBHOOK', 'MANUAL_IMPORT', 'MANUAL_ENTRY', 'WEBSITE', 'OTHER'],
      default: 'MANUAL_ENTRY',
    },
    syncStatus: {
      type: String,
      enum: ['SUCCESS', 'PENDING', 'FAILED'],
      default: 'SUCCESS',
    },
    history: [LeadHistorySchema],
    tags: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

LeadSchema.index({ organizationId: 1, leadCode: 1 }, { unique: true });
LeadSchema.index({ organizationId: 1, status: 1, nextFollowUpDate: 1 });
LeadSchema.index({ organizationId: 1, phone: 1 });
LeadSchema.index({ organizationId: 1, name: 'text', notes: 'text', preferredLocation: 'text' });
// Compound unique index for Meta Lead ID within tenant
LeadSchema.index(
  { organizationId: 1, metaLeadId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { metaLeadId: { $type: 'string' } },
  }
);
LeadSchema.index({ organizationId: 1, isNewLead: 1, createdAt: -1 });
LeadSchema.index({ organizationId: 1, metaCampaignName: 1 });
LeadSchema.index({ organizationId: 1, metaFormId: 1 });

module.exports = mongoose.model('Lead', LeadSchema);
