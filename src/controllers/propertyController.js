const Property = require('../models/Property');
const Booking = require('../models/Booking');
const SiteVisit = require('../models/SiteVisit');
const { PROPERTY_AVAILABILITY, AUDIT_ACTIONS } = require('../constants/statuses');
const { logAudit } = require('../services/auditService');

// Helper to generate unique property code
const generatePropertyCode = async (organizationId, type) => {
  const count = await Property.countDocuments({ organizationId });
  const prefix = type === 'Residential Plot' ? 'PLT' : 'PROP';
  const sequence = String(count + 1).padStart(4, '0');
  return `EF-${prefix}-${sequence}`;
};

// 1. Get properties (with filters, search, pagination)
const getProperties = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      propertyType = '',
      status = '',
      city = '',
      minPrice = '',
      maxPrice = '',
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const query = { organizationId: req.organizationId };

    if (propertyType) query.propertyType = propertyType;
    if (status) query.status = status;
    if (city) query['location.city'] = new RegExp(city, 'i');

    if (minPrice || maxPrice) {
      query['pricing.basePrice'] = {};
      if (minPrice) query['pricing.basePrice'].$gte = Number(minPrice);
      if (maxPrice) query['pricing.basePrice'].$lte = Number(maxPrice);
    }

    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { title: regex },
        { unitNumber: regex },
        { propertyCode: regex },
        { projectName: regex },
        { 'location.locality': regex },
        { 'location.city': regex },
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = (pageNum - 1) * limitNum;

    const [properties, total] = await Promise.all([
      Property.find(query)
        .populate('assignedTo', 'firstName lastName email department')
        .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Property.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: properties,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
};

// 2. Get property by ID
const getPropertyById = async (req, res, next) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    })
      .populate('assignedTo', 'firstName lastName email phone')
      .populate('statusHistory.changedBy', 'firstName lastName')
      .populate('activeBookingId')
      .lean();

    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    // Fetch recent visits for this property
    const recentVisits = await SiteVisit.find({ propertyId: property._id })
      .populate('assignedTo', 'firstName lastName')
      .sort({ scheduledTime: -1 })
      .limit(5)
      .lean();

    return res.json({
      success: true,
      data: {
        ...property,
        recentVisits,
      },
    });
  } catch (err) {
    next(err);
  }
};

// 3. Create property
const createProperty = async (req, res, next) => {
  try {
    const {
      title,
      propertyType,
      listingType,
      unitNumber,
      projectName,
      location,
      area,
      facing,
      pricing,
      description,
      amenities,
      images,
      sellerDetails,
      assignedTo,
    } = req.body;

    if (!title || !propertyType || !unitNumber || !pricing?.basePrice || !area?.value) {
      return res.status(400).json({
        success: false,
        message: 'Title, property type, unit number, area value, and base price are required.',
      });
    }

    // Check duplicate unit in the same project
    const existing = await Property.findOne({
      organizationId: req.organizationId,
      unitNumber: unitNumber.trim(),
      projectName: projectName ? projectName.trim() : '',
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Unit/Plot #${unitNumber} already exists in project "${projectName || 'Default'}".`,
      });
    }

    const propertyCode = await generatePropertyCode(req.organizationId, propertyType);

    // Calculate rate per unit area
    const calculatedRate = area?.value > 0 ? Math.round(pricing.basePrice / area.value) : 0;

    const property = await Property.create({
      organizationId: req.organizationId,
      propertyCode,
      title: title.trim(),
      propertyType,
      listingType: listingType || 'Sale',
      unitNumber: unitNumber.trim(),
      projectName: projectName ? projectName.trim() : '',
      location: location || {},
      area: area || { value: 1000, unit: 'sq.ft' },
      facing: facing || 'East',
      pricing: {
        basePrice: pricing.basePrice,
        ratePerUnitArea: pricing.ratePerUnitArea || calculatedRate,
        bookingTokenAmount: pricing.bookingTokenAmount || 50000,
      },
      description: description || '',
      amenities: amenities || [],
      images: images || [],
      sellerDetails: sellerDetails || {},
      assignedTo: assignedTo || null,
      status: PROPERTY_AVAILABILITY.AVAILABLE,
      statusHistory: [
        {
          newStatus: PROPERTY_AVAILABILITY.AVAILABLE,
          reason: 'Property added to inventory',
          changedBy: req.user._id,
        },
      ],
    });

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.PROPERTY_CREATED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Property',
      entityId: property._id,
      details: { propertyCode: property.propertyCode, unitNumber: property.unitNumber, price: property.pricing.basePrice },
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Property successfully added to inventory',
      data: property,
    });
  } catch (err) {
    next(err);
  }
};

// 4. Update property
const updateProperty = async (req, res, next) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    const {
      title,
      propertyType,
      listingType,
      unitNumber,
      projectName,
      location,
      area,
      facing,
      pricing,
      description,
      amenities,
      images,
      sellerDetails,
      assignedTo,
      status,
      statusChangeReason,
    } = req.body;

    // Status transition tracking
    if (status && status !== property.status) {
      // Prevent manually setting to Available if there is an active confirmed booking
      if (status === PROPERTY_AVAILABILITY.AVAILABLE && property.activeBookingId) {
        const activeBooking = await Booking.findById(property.activeBookingId);
        if (activeBooking && ['Confirmed', 'Pending Approval'].includes(activeBooking.status)) {
          return res.status(400).json({
            success: false,
            message: `Cannot mark property as Available: It is currently linked to an active booking (${activeBooking.bookingReference}). Cancel or release the booking first.`,
          });
        }
      }

      property.statusHistory.push({
        previousStatus: property.status,
        newStatus: status,
        reason: statusChangeReason || 'Status update',
        changedBy: req.user._id,
      });

      property.status = status;
    }

    if (title) property.title = title.trim();
    if (propertyType) property.propertyType = propertyType;
    if (listingType) property.listingType = listingType;
    if (unitNumber) property.unitNumber = unitNumber.trim();
    if (projectName !== undefined) property.projectName = projectName.trim();
    if (location) property.location = { ...property.location, ...location };
    if (area) property.area = { ...property.area, ...area };
    if (facing) property.facing = facing;
    if (pricing) property.pricing = { ...property.pricing, ...pricing };
    if (description !== undefined) property.description = description;
    if (amenities) property.amenities = amenities;
    if (images) property.images = images;
    if (sellerDetails) property.sellerDetails = sellerDetails;
    if (assignedTo !== undefined) property.assignedTo = assignedTo;

    await property.save();

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.PROPERTY_UPDATED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Property',
      entityId: property._id,
      details: { updates: req.body },
      req,
    });

    return res.json({
      success: true,
      message: 'Property updated successfully',
      data: property,
    });
  } catch (err) {
    next(err);
  }
};

// 5. Delete property
const deleteProperty = async (req, res, next) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    if (property.status === PROPERTY_AVAILABILITY.SOLD || property.status === PROPERTY_AVAILABILITY.RESERVED) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a reserved or sold property. Set status to Inactive instead to preserve audit history.',
      });
    }

    await Property.findByIdAndDelete(property._id);

    return res.json({
      success: true,
      message: 'Property removed successfully',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  deleteProperty,
};
