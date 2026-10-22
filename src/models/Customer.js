const mongoose = require('mongoose');

const DocumentAttachmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileType: { type: String, default: 'application/pdf' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const CustomerSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    customerCode: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
      maxlength: 120,
    },
    phone: {
      type: String,
      required: [true, 'Customer phone is required'],
      trim: true,
      index: true,
    },
    alternativePhone: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    address: {
      street: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      postalCode: { type: String, default: '' },
      country: { type: String, default: 'India' },
    },
    identityProof: {
      idType: { type: String, default: 'PAN' },
      idNumber: { type: String, default: '' },
    },
    originLeadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
    },
    assignedExecutive: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    preferences: {
      propertyType: { type: String, default: '' },
      preferredLocation: { type: String, default: '' },
      budget: { type: Number, default: 0 },
    },
    notes: {
      type: String,
      default: '',
    },
    documents: [DocumentAttachmentSchema],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

CustomerSchema.index({ organizationId: 1, customerCode: 1 }, { unique: true });
CustomerSchema.index({ organizationId: 1, phone: 1 });
CustomerSchema.index({ organizationId: 1, name: 'text', phone: 'text', email: 'text' });

module.exports = mongoose.model('Customer', CustomerSchema);
