import FileShare from '../models/fileShare.model.js';
import { 
  createFileShare, 
  accessFileShare, 
  getUserFileShares, 
  renewFileShare 
} from '../services/fileShareService.js';
import { storeMedia } from '../services/mediaService.js';

// Create a new file share via REST API
export const createFileShareAPI = async (req, res) => {
  try {
    const { 
      password, 
      expirationDays, 
      isAlbum, 
      albumName, 
      albumDescription 
    } = req.body;

    let fileData = [];

    // Handle single file upload
    if (req.file) {
      const media = await storeMedia(req.file, 'shares');
      fileData.push({
        fileId: req.file.filename || Date.now().toString(),
        fileName: req.file.originalname,
        mediaPath: media.url,
        mediaSize: req.file.size,
        mimeType: req.file.mimetype
      });
    } 
    // Handle multiple files (album)
    else if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const media = await storeMedia(file, 'shares');
        fileData.push({
          fileId: file.filename || Date.now().toString(),
          fileName: file.originalname,
          mediaPath: media.url,
          mediaSize: file.size,
          mimeType: file.mimetype
        });
      }
    } else {
      return res.status(400).json({ message: 'No files provided' });
    }

    const shareOptions = {
      password,
      expirationDays,
      isAlbum,
      albumName,
      albumDescription
    };

    const fileShare = await createFileShare(
      { userId: req.user.id },
      fileData,
      shareOptions
    );

    res.status(201).json({
      _id: fileShare._id,
      accessCode: fileShare.accessCode,
      isPasswordProtected: fileShare.isPasswordProtected,
      expiresAt: fileShare.expiresAt,
      isAlbum: fileShare.isAlbum,
      albumName: fileShare.albumName,
      files: fileShare.files.map(file => ({
        fileName: file.fileName,
        fileId: file.fileId
      }))
    });
  } catch (error) {
    console.error('Error creating file share:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Access a shared file via REST API
export const accessFileShareAPI = async (req, res) => {
  try {
    const { accessCode, password } = req.body;
    
    if (!accessCode) {
      return res.status(400).json({ message: 'Access code is required' });
    }

    const userData = req.user ? {
      userId: req.user.id,
      ipAddress: req.ip
    } : {
      ipAddress: req.ip
    };

    const result = await accessFileShare(accessCode, password, userData);
    
    // If password is required but not provided or invalid
    if (result.requiresPassword) {
      return res.status(403).json({ 
        message: 'Password required', 
        requiresPassword: true 
      });
    }

    res.json({
      _id: result._id,
      isAlbum: result.isAlbum,
      albumName: result.albumName,
      albumDescription: result.albumDescription,
      files: result.files.map(file => ({
        fileName: file.fileName,
        fileId: file.fileId,
        mediaPath: file.mediaPath,
        mediaSize: file.mediaSize,
        mediaDuration: file.mediaDuration,
        mimeType: file.mimeType
      }))
    });
  } catch (error) {
    console.error('Error accessing file share:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// Get user's file shares via REST API
export const getUserFileSharesAPI = async (req, res) => {
  try {
    const fileShares = await getUserFileShares(req.user.id);
    
    res.json({
      fileShares: fileShares.map(share => ({
        _id: share._id,
        accessCode: share.accessCode,
        isPasswordProtected: share.isPasswordProtected,
        expiresAt: share.expiresAt,
        isActive: share.isActive,
        isAlbum: share.isAlbum,
        albumName: share.albumName,
        accessCount: share.accessCount,
        lastAccessed: share.lastAccessed,
        createdAt: share.createdAt,
        files: share.files.map(file => ({
          fileName: file.fileName,
          fileId: file.fileId,
          mediaSize: file.mediaSize,
          mimeType: file.mimeType
        }))
      }))
    });
  } catch (error) {
    console.error('Error getting user file shares:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Renew an expired file share via REST API
export const renewFileShareAPI = async (req, res) => {
  try {
    const { fileShareId } = req.params;
    const { expirationDays } = req.body;
    
    if (!fileShareId) {
      return res.status(400).json({ message: 'File share ID is required' });
    }

    const renewedShare = await renewFileShare(
      fileShareId, 
      req.user.id, 
      expirationDays
    );
    
    res.json({
      _id: renewedShare._id,
      expiresAt: renewedShare.expiresAt,
      isActive: renewedShare.isActive
    });
  } catch (error) {
    console.error('Error renewing file share:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// Delete a file share via REST API
export const deleteFileShareAPI = async (req, res) => {
  try {
    const { fileShareId } = req.params;
    
    if (!fileShareId) {
      return res.status(400).json({ message: 'File share ID is required' });
    }

    const fileShare = await FileShare.findOne({
      _id: fileShareId,
      owner: req.user.id
    });

    if (!fileShare) {
      return res.status(404).json({ message: 'File share not found or you are not the owner' });
    }

    await FileShare.deleteOne({ _id: fileShareId });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting file share:', error);
    res.status(500).json({ message: 'Server error' });
  }
};