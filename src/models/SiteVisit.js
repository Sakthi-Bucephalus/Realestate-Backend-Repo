const mongoose = require('mongoose');
const { SITE_VISIT_STATUSES } = require('../constants/statuses');

const SiteVisitSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    visitCode: {
      type: String,
      required: true,
      trim: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    visitorName: {
      type: String,
      required: [true, 'Visitor name is required'],
      trim: true,
    },
    visitorPhone: {
      type: String,
      required: [true, 'Visitor phone is required'],
      trim: true,
    },
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property is required for site visit'],
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Assigned executive is required'],
      index: true,
    },
    scheduledTime: {
      type: Date,
      required: [true, 'Scheduled date and time is required'],
      index: true,
    },
    meetingPoint: {
      type: String,
      default: 'Site Office',
    },
    transportRequired: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: Object.values(SITE_VISIT_STATUSES),
      default: SITE_VISIT_STATUSES.SCHEDULED,
      index: true,
    },
    outcome: {
      type: String,
      enum: [
        'Pending Visit',
        'Ready to Book',
        'Negotiating Price',
        'Needs Follow-up',
        'Budget Mismatch',
        'Location Not Preferred',
        'Did Not Turn Up',
        'Other',
      ],
      default: 'Pending Visit',
    },
    feedbackNotes: {
      type: String,
      default: '',
    },
    nextFollowUpDate: {
      type: Date,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: '',
    },
    reminders: {
      sent24h: { type: Boolean, default: false },
      sent2h: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
  }
);

SiteVisitSchema.index({ organizationId: 1, scheduledTime: 1 });
SiteVisitSchema.index({ organizationId: 1, status: 1 });

module.exports = mongoose.model('SiteVisit', SiteVisitSchema);
