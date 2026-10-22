const mongoose = require('mongoose');
const { PROPERTY_TYPES, PROPERTY_AVAILABILITY, AREA_UNITS } = require('../constants/statuses');

const PropertyStatusHistorySchema = new mongoose.Schema(
  {
    previousStatus: String,
    newStatus: String,
    reason: { type: String, default: '' },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const PropertySchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    propertyCode: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: [true, 'Property title is required'],
      trim: true,
      maxlength: 150,
    },
    propertyType: {
      type: String,
      enum: Object.values(PROPERTY_TYPES),
      required: true,
      index: true,
    },
    listingType: {
      type: String,
      enum: ['Sale', 'Resale', 'Lease', 'Joint Venture'],
      default: 'Sale',
    },
    unitNumber: {
      type: String,
      required: [true, 'Unit or Plot number is required'],
      trim: true,
      index: true,
    },
    projectName: {
      type: String,
      trim: true,
      default: '',
    },
    location: {
      locality: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      landmark: { type: String, default: '' },
      coordinates: {
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null },
      },
    },
    area: {
      value: {
        type: Number,
        required: [true, 'Area measurement is required'],
        min: 1,
      },
      unit: {
        type: String,
        enum: AREA_UNITS,
        default: 'sq.ft',
      },
    },
    facing: {
      type: String,
      enum: ['East', 'West', 'North', 'South', 'North-East', 'North-West', 'South-East', 'South-West', 'Corner'],
      default: 'East',
    },
    pricing: {
      basePrice: {
        type: Number,
        required: [true, 'Price is required'],
        min: 0,
        index: true,
      },
      ratePerUnitArea: {
        type: Number,
        default: 0,
      },
      bookingTokenAmount: {
        type: Number,
        default: 50000,
      },
    },
    description: {
      type: String,
      default: '',
    },
    amenities: {
      type: [String],
      default: [],
    },
    images: {
      type: [String],
      default: [],
    },
    documents: [
      {
        title: String,
        fileUrl: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    sellerDetails: {
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(PROPERTY_AVAILABILITY),
      default: PROPERTY_AVAILABILITY.AVAILABLE,
      index: true,
    },
    activeBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    statusHistory: [PropertyStatusHistorySchema],
  },
  {
    timestamps: true,
  }
);

PropertySchema.index({ organizationId: 1, propertyCode: 1 }, { unique: true });
PropertySchema.index({ organizationId: 1, status: 1 });
PropertySchema.index({ organizationId: 1, title: 'text', unitNumber: 'text', description: 'text' });

module.exports = mongoose.model('Property', PropertySchema);
