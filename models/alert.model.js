
import mongoose from "mongoose";

const AlertSchema = new mongoose.Schema({
    creator: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['danger', 'theft', 'robbery', 'other'],
        required: true
    },
    description: {
        type: String,
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
        }
    },
    radius: {
        type: Number, // rayon d'alerte en mètres
        default: 1000 //par defaut toute les personnes dans ce rayon ou plus seront alertées
    },
    mediaUrl: String,
    expireAt: {
        type: Date,
        default: function () {
            // Par défaut, les alertes expirent après 24 heures
            const now = new Date();
            return new Date(now.setHours(now.getHours() + 24));
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    confirmations: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true
});

AlertSchema.index({ "location.coordinates": '2dsphere' });
const Alert = mongoose.model('Alert', AlertSchema);

export default Alert;