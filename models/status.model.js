import mongoose from "mongoose";

const StatusSchema = new mongoose.Schema({
    creator: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    business: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Business'
    },
    content: {
        type: String
    },
    mediaUrl: String,
    mediaType: {
        type: String,
        enum: ['image', 'video', 'text'],
        default: 'text'
    },
    views: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        viewedAt: [{
            duration: { type: Number }, // durée de visualisation en secondes
            type: Date, ///prends la date de visualisation a chaque fois
        }]
    }],
    shares: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        sharedAt: {
            type: Date,
            default: Date.now
        },
        viewsGenerated: {
            type: Number,
            default: 0
        },
        earnings: {
            type: Number,
            default: 0
        },
        isPaid: {
            type: Boolean,
            default: false
        },
        pricePerView: {
            type: Number,
            default: 0.001  // 0.01 unité de monnaie par vue
        },
    }],
    totalViews: {
        type: Number,
        default: 0
    },
    totalShares: {
        type: Number,
        default: 0
    },
    averageViewDuration: {
        type: Number,
        default: 0
    },
    isPromoted: {
        type: Boolean,
        default: false
    },
  /*   promotionRadius: {
        type: Number,
        default: 1000 // rayon de promotion en mètres
    }, */
    expiresAt: {
        type: Date,
        default: function () {
            // Par défaut, les statuts expirent après 24 heures
            const now = new Date();
            return new Date(now.setHours(now.getHours() + 24));
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
}, {
    timestamps: true
});

// Middleware pour mettre à jour totalViews, totalShares et averageViewDuration
StatusSchema.pre('save', function (next) {
    this.totalViews = this.views.length;
    this.totalShares = this.shares.length;

    // Calculate average view duration
    if (this.views.length > 0) {
        let totalDuration = 0;
        this.views.forEach(view => {
            view.viewedAt.forEach(viewed => {
                totalDuration += viewed.duration || 0;
            });
        });
        this.averageViewDuration = totalDuration / this.views.length;
    } else {
        this.averageViewDuration = 0;
    }
    next();
});

const Status = mongoose.model('Status', StatusSchema);

export default Status;