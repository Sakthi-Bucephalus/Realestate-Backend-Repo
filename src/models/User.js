const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, ROLE_LIST } = require('../constants/roles');

const UserSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: 60,
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: 60,
      default: '',
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    password: {
      type: String,
      select: false,
    },
    role: {
      type: String,
      enum: ROLE_LIST,
      default: ROLES.EMPLOYEE,
      required: true,
      index: true,
    },
    employeeId: {
      type: String,
      trim: true,
      default: '',
    },
    department: {
      type: String,
      trim: true,
      default: 'Sales',
    },
    designation: {
      type: String,
      trim: true,
      default: 'Real Estate Executive',
    },
    avatar: {
      type: String,
      default: '',
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    statusChangeReason: {
      type: String,
      default: '',
    },
    statusChangedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    statusChangedAt: {
      type: Date,
      default: null,
    },
    // OTP verification fields
    otpHash: {
      type: String,
      select: false,
      default: null,
    },
    otpExpiresAt: {
      type: Date,
      default: null,
    },
    otpAttempts: {
      type: Number,
      default: 0,
    },
    lastOtpResentAt: {
      type: Date,
      default: null,
    },
    // Session invalidation
    tokenVersion: {
      type: Number,
      default: 1,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    customPermissions: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Compound index on organization and email
UserSchema.index({ organizationId: 1, email: 1 }, { unique: true });

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to verify password
UserSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Method to verify OTP
UserSchema.methods.compareOtp = async function (candidateOtp) {
  if (!this.otpHash) return false;
  return bcrypt.compare(candidateOtp, this.otpHash);
};

// Virtual for full name
UserSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

UserSchema.set('toJSON', { virtuals: true });
UserSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('User', UserSchema);
