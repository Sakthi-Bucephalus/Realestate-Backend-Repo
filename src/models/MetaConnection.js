const mongoose = require('mongoose');

const MetaFormConfigSchema = new mongoose.Schema(
  {
    formId: {
      type: String,
      required: true,
      trim: true,
    },
    formName: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      default: 'ACTIVE',
    },
    leadsCount: {
      type: Number,
      default: 0,
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
    isSelected: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const MetaPageConfigSchema = new mongoose.Schema(
  {
    pageId: {
      type: String,
      required: true,
      trim: true,
    },
    pageName: {
      type: String,
      required: true,
      trim: true,
    },
    pageCategory: {
      type: String,
      default: '',
    },
    // Encrypted AES-256-GCM token format: iv:authTag:encryptedData
    encryptedPageAccessToken: {
      type: String,
      required: true,
      select: false, // Protected from casual projections
    },
    isSubscribedToWebhook: {
      type: Boolean,
      default: false,
    },
    webhookSubscribedAt: {
      type: Date,
      default: null,
    },
    isSelected: {
      type: Boolean,
      default: true,
    },
    forms: [MetaFormConfigSchema],
  },
  { _id: true }
);

const MetaConnectionSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      unique: true,
      index: true,
    },
    connectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    facebookUserId: {
      type: String,
      required: true,
      trim: true,
    },
    facebookUserName: {
      type: String,
      default: '',
    },
    facebookUserEmail: {
      type: String,
      default: '',
    },
    // Long-lived user access token encrypted at rest
    encryptedUserAccessToken: {
      type: String,
      required: true,
      select: false,
    },
    userAccessTokenExpiresAt: {
      type: Date,
      default: null,
    },
    tokenType: {
      type: String,
      default: 'USER_LONG_LIVED',
    },
    grantedScopes: {
      type: [String],
      default: ['leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'],
    },
    selectedPages: [MetaPageConfigSchema],
    status: {
      type: String,
      enum: ['CONNECTED', 'DISCONNECTED', 'EXPIRED', 'NEEDS_REAUTHORIZATION', 'ERROR'],
      default: 'CONNECTED',
      index: true,
    },
    healthStatus: {
      type: String,
      enum: ['HEALTHY', 'NEEDS_REAUTHORIZATION', 'ERROR', 'UNCHECKED'],
      default: 'HEALTHY',
    },
    healthDetails: {
      type: String,
      default: 'Connection verified and operational',
    },
    lastHealthCheckAt: {
      type: Date,
      default: Date.now,
    },
    lastSyncAt: {
      type: Date,
      default: null,
    },
    lastSyncStatus: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'IN_PROGRESS', 'IDLE'],
      default: 'IDLE',
    },
    lastSyncMessage: {
      type: String,
      default: '',
    },
    totalLeadsImported: {
      type: Number,
      default: 0,
    },
    appId: {
      type: String,
      default: '',
    },
    metaGraphVersion: {
      type: String,
      default: 'v21.0',
    },
  },
  {
    timestamps: true,
  }
);

MetaConnectionSchema.index({ 'selectedPages.pageId': 1 });

module.exports = mongoose.model('MetaConnection', MetaConnectionSchema);
