
import mongoose from "mongoose";

const Schema = mongoose.Schema;
const MessageSchema = new Schema({
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: Schema.Types.ObjectId, ref: 'User' }, // Pour messages privés
    room: { type: Schema.Types.ObjectId, ref: 'Room' }, // Pour messages de groupe
    content: String,
    type: { type: String, enum: ['text', 'image', 'alert', 'video', 'audio', "pdf", "documents", 'commercial'] },
    isAnonymous: Boolean,
    status: {
        type: String,
        enum: ['SENT', 'DELIVERED',  'READ', 'FAILED' , "PENDING"], 
        default: 'SENT'
    },
    isArchived: { type: Boolean, default: false },
    seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    mediaPath: String,
    mediaDuration: Number,
    receivedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    mediaSize: Number,
}, {
    timestamps: true
})

MessageSchema.index({ room: 1, receivedBy: 1 });
MessageSchema.index({ receiver: 1 });
MessageSchema.index({ createdAt: -1 }); 
const Message = mongoose.model('Message', MessageSchema);
export default Message;