const LEAD_STATUSES = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  INTERESTED: 'Interested',
  SITE_VISIT_SCHEDULED: 'Site Visit Scheduled',
  NEGOTIATION: 'Negotiation',
  CONVERTED: 'Converted',
  LOST: 'Lost',
};

const LEAD_PRIORITIES = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

const LEAD_SOURCES = [
  'Website',
  'Referral',
  'Walk-in',
  'Social Media',
  'Advertisement',
  'Cold Call',
  'Channel Partner',
  'Other',
];

const PROPERTY_TYPES = {
  RESIDENTIAL_PLOT: 'Residential Plot',
  VILLA_HOUSE: 'Villa / House',
  APARTMENT: 'Apartment',
  COMMERCIAL: 'Commercial',
  LAND: 'Agricultural Land',
  INDUSTRIAL: 'Industrial',
};

const PROPERTY_AVAILABILITY = {
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  SOLD: 'Sold',
  INACTIVE: 'Inactive',
};

const AREA_UNITS = ['sq.ft', 'sq.yd', 'acres', 'cents', 'guntha'];

const SITE_VISIT_STATUSES = {
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  RESCHEDULED: 'Rescheduled',
  NO_SHOW: 'No Show',
};

const BOOKING_STATUSES = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

const PAYMENT_METHODS = [
  'Bank Transfer (NEFT/RTGS/IMPS)',
  'UPI',
  'Cheque',
  'Cash',
  'Demand Draft',
  'Credit/Debit Card',
];

const PAYMENT_STATUSES = {
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  CANCELLED: 'Cancelled',
};

const PAYMENT_TYPES = [
  'Booking Advance',
  'Installment',
  'Part Payment',
  'Final Settlement',
  'Registration Fees',
  'Other Charge',
];

const EMPLOYEE_STATUSES = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  ONBOARDING: 'Onboarding',
};

const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  LOGIN_FAILED: 'LOGIN_FAILED',
  USER_CREATED: 'USER_CREATED',
  USER_STATUS_CHANGED: 'USER_STATUS_CHANGED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PERMISSION_UPDATED: 'PERMISSION_UPDATED',
  MODULE_TOGGLED: 'MODULE_TOGGLED',
  LEAD_CREATED: 'LEAD_CREATED',
  LEAD_UPDATED: 'LEAD_UPDATED',
  LEAD_CONVERTED: 'LEAD_CONVERTED',
  PROPERTY_CREATED: 'PROPERTY_CREATED',
  PROPERTY_UPDATED: 'PROPERTY_UPDATED',
  PROPERTY_STATUS_CHANGED: 'PROPERTY_STATUS_CHANGED',
  SITE_VISIT_SCHEDULED: 'SITE_VISIT_SCHEDULED',
  SITE_VISIT_OUTCOME: 'SITE_VISIT_OUTCOME',
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  PAYMENT_RECORDED: 'PAYMENT_RECORDED',
  PAYMENT_REVERSED: 'PAYMENT_REVERSED',
  DATA_EXPORTED: 'DATA_EXPORTED',
};

module.exports = {
  LEAD_STATUSES,
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  PROPERTY_TYPES,
  PROPERTY_AVAILABILITY,
  AREA_UNITS,
  SITE_VISIT_STATUSES,
  BOOKING_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  EMPLOYEE_STATUSES,
  AUDIT_ACTIONS,
};
