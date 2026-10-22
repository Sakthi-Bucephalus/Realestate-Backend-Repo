const mongoose = require('mongoose');
const { BOOKING_STATUSES } = require('../constants/statuses');

const BookingAuditSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    note: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: true }
);

const BookingSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    bookingReference: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer is required for booking'],
      index: true,
    },
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property is required for booking'],
      index: true,
    },
    bookingDate: {
      type: Date,
      default: Date.now,
    },
    agreedPrice: {
      type: Number,
      required: [true, 'Agreed purchase price is required'],
      min: [0, 'Agreed price cannot be negative'],
    },
    bookingAmount: {
      type: Number,
      required: [true, 'Initial booking advance amount is required'],
      min: [0, 'Booking amount cannot be negative'],
    },
    totalPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceDue: {
      type: Number,
      default: 0,
    },
    paymentTerms: {
      type: String,
      default: 'Standard 30-day milestone payment schedule',
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(BOOKING_STATUSES),
      default: BOOKING_STATUSES.PENDING_APPROVAL,
      index: true,
    },
    cancellation: {
      cancelledAt: { type: Date, default: null },
      cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      reason: { type: String, default: '' },
      refundAmount: { type: Number, default: 0 },
    },
    documents: [
      {
        title: String,
        fileUrl: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    notes: {
      type: String,
      default: '',
    },
    history: [BookingAuditSchema],
  },
  {
    timestamps: true,
  }
);

BookingSchema.index({ organizationId: 1, bookingReference: 1 }, { unique: true });
BookingSchema.index({ organizationId: 1, status: 1 });

// Ensure balanceDue is calculated properly on save
BookingSchema.pre('save', function (next) {
  if (this.isModified('agreedPrice') || this.isModified('totalPaid')) {
    this.balanceDue = Math.max(0, this.agreedPrice - this.totalPaid);
  }
  next();
});

module.exports = mongoose.model('Booking', BookingSchema);
