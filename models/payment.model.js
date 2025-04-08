
import mongoose from 'mongoose';

const PaymentSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'Coins' // Devise de l'app par défaut
    },
    coinsEarned: { type: Number, default: 0 },
    type: {
        type: String,
        enum: ['room_subscription', 'room_refund', 'status-promotion', 'product-purchase', 'withdrawal', 'deposit', 'gift', 'verification-payment', 'functionnality-upgrade', 'transfer'], //ajoute une fonctionnalité dans ce tableau car l'utilisateur peux payer pour être verifier
        required: true
    },
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['card', 'mobile-money', 'bank-transfer', 'platform-balance'],
        required: true
    },

    relatedEntity: {
        entityType: {
            type: String,
            enum: ['room', 'status', 'business', 'product'] //permet d'itendifier le type d'entité concernée par la transaction
        },
        entityId: {
            type: mongoose.Schema.Types.ObjectId
        }
    }
}, {
    timestamps: true
});
PaymentSchema.index({ user: 1, createdAt: -1 });
PaymentSchema.index({ recipient: 1, createdAt: -1 });
PaymentSchema.index({ status: 1 });
PaymentSchema.index({ type: 1 });

const Payment = mongoose.model('Payment', PaymentSchema);
export default Payment;