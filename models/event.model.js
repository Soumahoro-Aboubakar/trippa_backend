//événement 

import mongoose from 'mongoose';
const EventSchema = new mongoose.Schema({
    creator: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    accessType: {
        type: String,
        enum: ['public', 'private', 'paid'],
        default: 'public'
    },
    price: {
        type: Number,
        min: 0,
        required: function () {
            return this.accessType === 'paid';
        }
    },
    eventType: {
        type: String,
        enum: ['social', 'business', 'community', 'emergency', 'promotion', 'other'],
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
        address: String,
        venueName: String
    },
    visibilityRadius: {
        type: Number, // en mètres
        default: 1000
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    repeat: {
        type: String,
        enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'],
        default: 'none'
    },
    participants: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        status: {
            type: String,
            enum: ['invited', 'going', 'maybe', 'declined'],
            default: 'invited'
        },
        joinedAt: {
            type: Date
        }
    }],
    maxParticipants: {
        type: Number
    },
    isPublic: {
        type: Boolean,
        default: true
    },
    isPaid: {
        type: Boolean,
        default: false
    },
    price: {
        type: Number,
        default: 0
    },
    categories: [String],
    tags: [String],
    media: [{
        type: {
            type: String,
            enum: ['image', 'video', 'document']
        },
        url: String,
        caption: String //nom original de l'image
    }],
    status: {
        type: String,
        enum: ['draft', 'scheduled', 'active', 'cancelled', 'completed'],
        default: 'draft'
    },
    dangerLevel: {
        type: Number,
        min: 0,
        max: 3,
        default: 0 // 0=sûr, 1=risque modéré, 2=dangereux, 3=urgence
    }
}, {
    timestamps: true
});

// Index géospatial pour les recherches par localisation
EventSchema.index({ "location.coordinates": "2dsphere" });
EventSchema.index({ startTime: 1 });

// Méthode pour trouver les événements à proximité
EventSchema.statics.findNearby = function (coordinates, maxDistance, eventType) {
    const query = {
        status: { $in: ['scheduled', 'active'] },
        startDate: { $gte: new Date() },
        'location.coordinates': {
            $near: {
                $geometry: {
                    type: 'Point',
                    coordinates: coordinates
                },
                $maxDistance: maxDistance // en mètres
            }
        }
    };

    if (eventType) {
        query.eventType = eventType;
    }

    return this.find(query);
};

// Méthode pour inviter des participants
EventSchema.methods.inviteParticipants = function (userIds) {
    const newParticipants = userIds.map(userId => ({
        user: userId,
        status: 'invited'
    }));

    this.participants = [...this.participants, ...newParticipants];
    return this.save();
};

const Event = mongoose.model('Event', EventSchema);
export default Event;