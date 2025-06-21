import mongoose from "mongoose";

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    roomAccessCode: { type: String, unique: true },
    description: { type: String, default: "" },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    messageDeadline: {
      type: Date,
    }, // Date limite d'envoi de messages dans le groupe, modifiable uniquement par le créateur.
    groupKSD: { type: String, required: true }, /// c'est un KSD (code) commençant par G- et permettant d'identifier un groupe de discussion spécifique via les champs de récherche
    isPaid: { type: Boolean, default: false },
    isPrivate: { type: Boolean, default: false }, //ici cet attribut est pour les groupes privés peux importe le nombre de membres
    isGroup: { type: Boolean, default: false }, //ici cet attribut permet de savoir s'il agit d'une commucation entre deux personnes ou un groupe
    accessCode: { type: String, default: null }, // ici cet attribut est pour les group privés avec un code d'accès pour les membres qui veulent rejoindre le groupe
    price: Number, // Prix de la room si elle est payante
    isActive: { type: Boolean, default: true },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
      address: String,
      venueName: String,
    },
    photo: String,
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
    visibility: {
      type: String,
      enum: ["public", "private", "friends"],
      default: "public",
    },
    wallet: {
      balance: { type: Number, default: 0 }, // Solde du groupe
      transactions: [
        { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
      ], // Historique des transactions du groupe
    },
    averageRating: {
      type: Number,
      default: 0,
    },
    refundable: {
      type: Boolean,
      default: true,
    }, // Indique si les membres peuvent demander un remboursement
    refundPeriodDays: {
      type: Number,
      default: 3,
    }, // Nombre de jours pendant lesquels les membres peuvent demander un remboursement
    bannedUsers: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        reason: String,
        bannedAt: { type: Date, default: Date.now },
      },
    ], // Liste des utilisateurs bannis du groupe
    messageOptions: {
      type: String,
      enum: ["text", "audio", "all", "only_text", "only_audio", "only_file"],
      default: "all",
    },
    isSearchable: {
      type: Boolean,
      default: true, // true = la room est visible dans les recherches
    },
    messageOptionsUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Index pour les recherches plus rapides
roomSchema.index({ name: "text" });
roomSchema.index({ "location.coordinates": "2dsphere" });

const Room = mongoose.model("Room", roomSchema);

export default Room;
