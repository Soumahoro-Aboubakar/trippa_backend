
import mongoose from 'mongoose';
const Schema = mongoose.Schema;
const UserSchema = new Schema({
    userPseudo: { type: String },
    phone: { type: String, required: true },
    refreshTokens: [{ deviceId: String, token: String }],
    KSD: { type: String, required: true }, //une numéro de téléphone unique pour chaque utilisateur pour permettre aux utilisateurs d'échanger ou de se rétrouver sans avoir à partager leur numéro de téléphone, (la longeur varien en 3 et 5 (combinaison de chiffre et de lettre exemple: 1234A,88B))) attribuer automatiquer à la création de l'utilisateur,  definition:  Konnect Secure Descriptor , slogan : Votre identifiant social sécurisé – Connectez-vous sans révéler votre numéro !
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
        },
        address: String,
        venueName: String
    }, email: {
        type: String,
        unique: true,
        trim: true, sparse: true,
    },
    verifyCode: {
        code: String,
        createdAt: {
            type: Date,
            default: Date.now,
        },
    },
    profile: {
        bio: String,
        interests: [String],
        photo: String,
        isShyMode: Boolean,
        visibility: {
            type: String,
            enum: ['public', 'private', 'friends'],
            default: 'public'
        },
        profileViewers: [{
            userId: { type: Schema.Types.ObjectId, ref: 'User' },
            viewedAt: {
                type: Date,
                default: Date.now
            }
        }],
        statusViewers: [{
            userId: { type: Schema.Types.ObjectId, ref: 'User' },
            viewDuration: Number, // en secondes
            viewedAt: Date
        }]
    },
    statusShared: [{
        statusId: { type: Schema.Types.ObjectId, ref: 'Status' },
    }],
    lastLocation: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            default: [0, 0]
        },
        updatedAt: {
            type: Date,
            default: Date.now
        }
    },
    rooms: {
        type: [Schema.Types.ObjectId],
        ref: 'Room',
    },
    wallet: {
        balance: { type: Number, default: 0 },
        transactions: [{ type: Schema.Types.ObjectId, ref: 'Payment' }]
    },
    isOnline: { type: Boolean, default: false },
    lastConnection: { type: Date },
    isVerified: { type: Boolean, default: false }, ///Pour l'optention de badge
}, {
    timestamps: true
});

UserSchema.index({ "location.coordinates": '2dsphere' });

const User = mongoose.model('User', UserSchema);
export default User;