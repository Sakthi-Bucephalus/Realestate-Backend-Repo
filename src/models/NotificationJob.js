const mongoose = require('mongoose');

const NotificationJobSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    jobType: {
      type: String,
      enum: ['EMAIL', 'IN_APP', 'SMS'],
      default: 'EMAIL',
    },
    recipientEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    recipientName: {
      type: String,
      default: '',
    },
    subject: {
      type: String,
      required: true,
    },
    bodyHtml: {
      type: String,
      required: true,
    },
    bodyText: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'RETRYING'],
      default: 'QUEUED',
      index: true,
    },
    attemptCount: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 4,
    },
    nextRunAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastError: {
      type: String,
      default: '',
    },
    idempotencyKey: {
      type: String,
      required: true,
    },
    sentAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

NotificationJobSchema.index({ idempotencyKey: 1 }, { unique: true });
NotificationJobSchema.index({ status: 1, nextRunAt: 1 });

module.exports = mongoose.model('NotificationJob', NotificationJobSchema);
