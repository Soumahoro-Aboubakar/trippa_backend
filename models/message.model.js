
import mongoose from "mongoose";
import { userDataToSelect } from "../controllers/userController";

//NB: room = room.id et non room._id
const Schema = mongoose.Schema;
const MessageSchema = new Schema({
    id:{type : String, required : true, unique: true}, //très important pour mettre à jours le status du message côté frontend
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: Schema.Types.ObjectId, ref: 'User' }, // Pour messages privés
  //  roomId: { type: String },  Pour messages de groupe. Pour le croisement avec la room, on utilise l'id de la room et non son _id
    content: String,
    room : { type: Schema.Types.ObjectId, ref: 'Room' },
    type: { type: String, enum: ['text', 'image', 'alert', 'video', 'audio', "pdf", "documents", 'commercial'] },
    isAnonymous: Boolean,
    status: {
        type: String,
        enum: ['RECEIVED_BY_SERVER' , 'DELIVERED', 'UNREAD',  'READ', /*les cas sont dans un context ou c'est le serveur qui créer le message */  'FAILED' ,"PENDING"], 
        default: 'RECEIVED_BY_SERVER'
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

MessageSchema.statics.getReceivedMessages = async function(userId) {
    if (!userId) return [];

   const messages = await this.find(
            { receiver: userId, status: 'RECEIVED_BY_SERVER' }
        ).populate('sender', userDataToSelect("121","451")) //j'utilise des nombre aléatoire juste pour ne pas extraire certainnes informations
        .populate('receiver', userDataToSelect("121","451")).populate("room")
     //   .sort({ createdAt: -1 })
        return messages;
};

MessageSchema.index({ room: 1, receivedBy: 1 });
MessageSchema.index({ receiver: 1 });
MessageSchema.index({ createdAt: -1 }); 
const Message = mongoose.model('Message', MessageSchema);
export default Message;