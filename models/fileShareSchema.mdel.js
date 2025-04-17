import mongoose from 'mongoose';
const Schema = mongoose.Schema;

const FileShareSchema = new Schema({
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  files: [{
    fileId: String,
    fileName: String,
    mediaPath: String,
    mediaSize: Number,
    mediaDuration: Number,
    mimeType: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  accessCode: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    default: null
  },
  isPasswordProtected: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    required: true
  },
  isAlbum: {
    type: Boolean,
    default: false
  },
  albumName: String,
  albumDescription: String,
  accessCount: {
    type: Number,
    default: 0
  },
  lastAccessed: Date,
  accessLog: [{
    accessedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null // For anonymous access
    },
    accessedAt: {
      type: Date,
      default: Date.now
    },
    
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Generate a unique access code
FileShareSchema.statics.generateAccessCode = function(length = 4) {
  // Validate length (between 2 and 5)
  const codeLength = Math.min(Math.max(length, 2), 5);
  
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < codeLength; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
};

const FileShare = mongoose.model('FileShare', FileShareSchema);
export default FileShare;