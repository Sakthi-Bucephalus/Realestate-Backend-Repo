const mongoose = require('mongoose');
const { ROLE_LIST } = require('../constants/roles');

const RolePermissionSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ROLE_LIST,
      required: true,
      index: true,
    },
    allowedModules: {
      type: [String],
      default: [],
    },
    allowedPermissions: {
      type: [String],
      default: [],
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

RolePermissionSchema.index({ organizationId: 1, role: 1 }, { unique: true });

module.exports = mongoose.model('RolePermission', RolePermissionSchema);
