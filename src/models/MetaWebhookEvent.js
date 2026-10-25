const mongoose = require('mongoose');

const MetaWebhookEventSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
    },
    eventId: {
      type: String,
      trim: true,
      index: true,
    },
    leadgenId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    pageId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    formId: {
      type: String,
      trim: true,
      default: '',
    },
    adId: {
      type: String,
      trim: true,
      default: '',
    },
    adgroupId: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DUPLICATE'],
      default: 'RECEIVED',
      index: true,
    },
    attemptCount: {
      type: Number,
      default: 0,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    errorMessage: {
      type: String,
      default: '',
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Idempotency index on leadgenId and pageId to prevent duplicate webhook processing
MetaWebhookEventSchema.index({ pageId: 1, leadgenId: 1 });
MetaWebhookEventSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('MetaWebhookEvent', MetaWebhookEventSchema);
