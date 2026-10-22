const mongoose = require('mongoose');
const { PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_TYPES } = require('../constants/statuses');

const PaymentSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    paymentReference: {
      type: String,
      required: true,
      trim: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: [true, 'Booking reference is required'],
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer reference is required'],
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Payment amount is required'],
      min: [0.01, 'Payment amount must be greater than zero'],
    },
    paymentDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      required: true,
    },
    paymentType: {
      type: String,
      enum: PAYMENT_TYPES,
      default: 'Installment',
    },
    transactionReference: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUSES),
      default: PAYMENT_STATUSES.COMPLETED,
      index: true,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    receiptNumber: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      default: '',
    },
    // Immutable Reversal tracking
    isReversed: {
      type: Boolean,
      default: false,
    },
    reversedAt: {
      type: Date,
      default: null,
    },
    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reversalReason: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

PaymentSchema.index({ organizationId: 1, paymentReference: 1 }, { unique: true });
PaymentSchema.index({ organizationId: 1, bookingId: 1 });
PaymentSchema.index({ organizationId: 1, paymentDate: 1 });

module.exports = mongoose.model('Payment', PaymentSchema);
