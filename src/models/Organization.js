const mongoose = require('mongoose');
const { MODULE_LIST } = require('../constants/modules');

const OrganizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Organization name is required'],
      trim: true,
      maxlength: 120,
    },
    legalName: {
      type: String,
      trim: true,
      maxlength: 150,
    },
    registrationNumber: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Official email is required'],
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    website: {
      type: String,
      trim: true,
    },
    address: {
      street: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      postalCode: { type: String, default: '' },
      country: { type: String, default: 'India' },
    },
    logo: {
      type: String,
      default: '',
    },
    branding: {
      primaryColor: { type: String, default: '#B88A2E' },
      darkGold: { type: String, default: '#8C671D' },
      lightGold: { type: String, default: '#F5EBD3' },
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
    },
    currency: {
      code: { type: String, default: 'INR' },
      symbol: { type: String, default: '₹' },
    },
    smtpConfig: {
      host: { type: String, default: '' },
      port: { type: Number, default: 587 },
      secure: { type: Boolean, default: false },
      user: { type: String, default: '' },
      pass: { type: String, default: '' },
      fromEmail: { type: String, default: '' },
      isConfigured: { type: Boolean, default: false },
      lastTestedAt: { type: Date },
    },
    enabledModules: {
      type: [String],
      default: MODULE_LIST,
    },
    prefixes: {
      lead: { type: String, default: 'EF-LD' },
      booking: { type: String, default: 'EF-BK' },
      payment: { type: String, default: 'EF-PAY' },
      property: { type: String, default: 'EF-PROP' },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

OrganizationSchema.index({ email: 1 });

module.exports = mongoose.model('Organization', OrganizationSchema);
