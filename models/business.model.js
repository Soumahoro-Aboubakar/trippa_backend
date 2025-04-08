import mongoose from "mongoose";

const BusinessSchema = new mongoose.Schema({
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    description: String,
    category: {
        type: String,
        enum: ['restaurant', 'cafe', 'retail', 'service', 'other'],
        required: true
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true
        },
        address: String
    },
    contactInfo: {
        phone: String,
        email: String,
        website: String
    },
    openingHours: [{
        day: {
            type: String,
            enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        },
        open: String,
        close: String
    }],
    photos: [String],
    products: [{
        name: String,
        description: String,
        price: Number,
        photo: String
    }],
    ratings: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        rating: {
            type: Number,
            min: 1,
            max: 5
        },
        comment: String,
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    averageRating: {
        type: Number,
        default: 0
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    productLimit: {
        type: Number,
        default: 100 // Nombre de produits gratuits par jour
    },
    isSubscriptionActive: {
        type: Boolean,
        default: false // Indique si l'abonnement est actif
    }
}, {
    timestamps: true
});

// Middleware pour calculer averageRating
BusinessSchema.pre('save', function (next) {
    if (this.ratings && this.ratings.length > 0) {
        const totalRating = this.ratings.reduce((sum, rating) => sum + rating.rating, 0);
        this.averageRating = totalRating / this.ratings.length;
    } else {
        this.averageRating = 0;
    }
    next();
});

BusinessSchema.index({ "location.coordinates": '2dsphere' });

const Business = mongoose.model('Business', BusinessSchema);

export default Business;