import mongoose from "mongoose";

const Schema = mongoose.Schema;

const GroupSchema = new Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    admins: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    isPaid: { type: Boolean, default: false },
    isPrivate: { type: Boolean, default: false },
    price: Number,

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
    }, photo: String,
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
    visibility: {
        type: String,
        enum: ['public', 'private', 'friends'],
        default: 'public'
    },
    wallet: {
        balance: { type: Number, default: 0 }, // Solde du groupe
        transactions: [{ type: Schema.Types.ObjectId, ref: 'Transaction' }]// Historique des transactions du groupe
    }, averageRating: {
        type: Number,
        default: 0
    },
}, {
    timestamps: true
});

GroupSchema.index({ "location.coordinates": '2dsphere' });

const Group = mongoose.model('Group', GroupSchema);

export default Group;