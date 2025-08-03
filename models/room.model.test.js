import mongoose from "mongoose";


/*
 Les modifications : il dévra avoir 5 types de rooms ["payante","gratuite","localisé","annonyme","deadline"]
*/
const roomSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isAnonymous: Boolean, //très important pour les groupes qui n'ont pas le roomType : anonymous, elle leurs permettra de prendre des avis des utilisateurs et faire de sondage anonyme, une fois activé 
    isVerified : { type :Boolean , default : false},
    description: { type: String, default: "" },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    messageDeadline: {
      type: Date,
    }, // Date limite d'envoi de messages dans le groupe, modifiable uniquement par le créateur.
    isPaid: { type: Boolean, default: false },
    isPrivate: { type: Boolean, default: false }, //ici cet attribut est pour les groupes privés peux importe le nombre de membres
    isGroup: { type: Boolean, default: false }, //ici cet attribut permet de savoir s'il agit d'une commucation entre deux personnes ou un groupe
    accessCode: { type: String, unique:true, default: null }, // ici cet attribut est pour les group privés avec un code d'accès pour les membres qui veulent rejoindre le groupe
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
    bannedUsers: [ //je dois changer le nom  par BannedUserFromRoom afin que cela soit conforme à mon frontend 
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
    roomType: {
      type: String,
      enum: ["payante","gratuite","localisé","annonyme","deadline","private"],
      default: "private",
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

// Index texte amélioré pour chercher sur plusieurs champs importants
roomSchema.index({
  name: "text",
  description: "text",
});

// Index géospatial
roomSchema.index({ "location.coordinates": "2dsphere" });

// Index unique pour éviter les duplications
//roomSchema.index({ roomAccessCode: 1 }, { unique: true });

// Index combinés pour filtrage rapide
roomSchema.index({ isPrivate: 1, accessCode: 1 });
roomSchema.index({ isGroup: 1, isVerified: 1 });
roomSchema.index({ "wallet.balance": -1 });
roomSchema.index({ averageRating: -1 });
roomSchema.index({ isSearchable: 1 });

// Index sur les utilisateurs bannis (utile pour vérifier accès)
roomSchema.index({ "bannedUsers.userId": 1 });

// Index sur les ratings pour stats ou tri
roomSchema.index({ "ratings.user": 1 });



const Room = mongoose.model("Room", roomSchema);

export default Room;
847*********************************************$^plkojh