import mongoose from "mongoose";

const BusinessSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    description: String,
    category: {
      type: String,
      enum: ["restaurant", "cafe", "retail", "service", "other"],
      required: true,
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
      address: String,
    },
    contactInfo: {
      phone: String,
      email: String,
      website: String,
    },

    coverMedia: {
      type: String,
    },
    openingHours: [
      {
        day: {
          type: String,
          enum: [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
          ],
        },
        open: String,
        close: String,
      },
    ],
    productsCollections: [
      {
        name: String,
        description: String,
        category: String,
        pricing: [
          {
            quantity: Number, // Number of items for this price point
            price: Number, // Price for this quantity
            description: String, // Optional description for this price point
          },
        ],
        quantity: Number, // Total available quantity
        media: String, // Media URL (images, videos, etc.)
      },
    ],
    ratings: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        rating: {
          type: Number,
          min: 1,
          max: 5,
        },
        comment: String,
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    averageRating: {
      type: Number,
      default: 0,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    productLimit: {
      type: Number,
      default: 10000000000, // Nombre de produits gratuits par jour
    },
    // Affiliate program settings
    affiliateProgram: {
      isActive: {
        type: Boolean,
        default: false,
      },
      defaultCommissionRate: {
        type: Number,
        default: 5, // percentage
      },
      customRates: [
        {
          user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
          rate: Number,
        },
      ],
      totalPaid: {
        type: Number,
        default: 0,
      },
      totalRevenue: {
        //represente le chiffre d'affaire total généré par le programme d'affiliation
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Middleware pour calculer averageRating
BusinessSchema.pre("save", function (next) {
  if (this.ratings && this.ratings.length > 0) {
    const totalRating = this.ratings.reduce(
      (sum, rating) => sum + rating.rating,
      0
    );
    this.averageRating = totalRating / this.ratings.length;
  } else {
    this.averageRating = 0;
  }
  next();
});

BusinessSchema.index({ "location.coordinates": "2dsphere" });

const Business = mongoose.model("Business", BusinessSchema);

export default Business;
