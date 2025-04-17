import bcrypt from 'bcrypt';
import FileShare from '../models/fileShareSchema.mdel.js';

// Create a new file share
export const createFileShare = async (ownerData, fileData, shareOptions) => {
  try {
    const { userId } = ownerData;
    const { 
      password, 
      expirationDays = 7, 
      isAlbum = false, 
      albumName, 
      albumDescription 
    } = shareOptions;

    // Validate expiration (max 7 days)
    const maxExpirationDays = 7;
    const validExpirationDays = Math.min(expirationDays, maxExpirationDays);
    
    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + validExpirationDays);

    // Generate a unique access code
    let accessCode;
    let isUnique = false;
    
    while (!isUnique) {
      accessCode = FileShare.generateAccessCode();
      const existingShare = await FileShare.findOne({ accessCode });
      if (!existingShare) {
        isUnique = true;
      }
    }

    // Hash password if provided
    let hashedPassword = null;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // Create the file share
    const fileShare = new FileShare({
      owner: userId,
      files: Array.isArray(fileData) ? fileData : [fileData],
      accessCode,
      password: hashedPassword,
      isPasswordProtected: !!password,
      expiresAt,
      isAlbum,
      albumName: isAlbum ? albumName : undefined,
      albumDescription: isAlbum ? albumDescription : undefined
    });

    await fileShare.save();
    
    return fileShare;
  } catch (error) {
    console.error('Error creating file share:', error);
    throw error;
  }
};

// Access a shared file
export const accessFileShare = async (accessCode, password, userData = null) => {
  try {
    const fileShare = await FileShare.findOne({ 
      accessCode, 
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

    if (!fileShare) {
      throw new Error('File share not found or expired');
    }

    // Check password if required
    if (fileShare.isPasswordProtected) {
      if (!password) {
        return { requiresPassword: true };
      }
      
      const isPasswordValid = await bcrypt.compare(password, fileShare.password);
      if (!isPasswordValid) {
        throw new Error('Invalid password');
      }
    }

    // Update access count and last accessed
    fileShare.accessCount += 1;
    fileShare.lastAccessed = new Date();

    // Log access
    fileShare.accessLog.push({
      accessedBy: userData ? userData.userId : null,
    });

    await fileShare.save();

    return fileShare;
  } catch (error) {
    console.error('Error accessing file share:', error);
    throw error;
  }
};

// Get all file shares for a user
export const getUserFileShares = async (userId) => {
  try {
    return await FileShare.find({ owner: userId }).sort({ createdAt: -1 });
  } catch (error) {
    console.error('Error getting user file shares:', error);
    throw error;
  }
};

// Renew an expired file share
export const renewFileShare = async (fileShareId, userId, expirationDays = 7) => {
  try {
    const fileShare = await FileShare.findOne({ 
      _id: fileShareId,
      owner: userId
    });

    if (!fileShare) {
      throw new Error('File share not found or you are not the owner');
    }

    // Calculate new expiration date
    const maxExpirationDays = 7;
    const validExpirationDays = Math.min(expirationDays, maxExpirationDays);
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + validExpirationDays);

    // Update expiration and activate
    fileShare.expiresAt = expiresAt;
    fileShare.isActive = true;

    await fileShare.save();
    
    return fileShare;
  } catch (error) {
    console.error('Error renewing file share:', error);
    throw error;
  }
};

/* // Check for expiring file shares and send notifications
export const checkExpiringFileShares = async () => {
  try {
    const oneDayFromNow = new Date();
    oneDayFromNow.setDate(oneDayFromNow.getDate() + 1);

    const expiringShares = await FileShare.find({
      isActive: true,
      expiresAt: { 
        $gt: new Date(),
        $lt: oneDayFromNow
      }
    }).populate('owner');

    return expiringShares.length;
  } catch (error) {
    console.error('Error checking expiring file shares:', error);
    throw error;
  }
}; */

// Mark expired file shares
export const markExpiredFileShares = async () => {
  try {
    const now = new Date();
    
    const result = await FileShare.updateMany(
      {
        isActive: true,
        expiresAt: { $lt: now }
      },
      {
        $set: { isActive: false }
      }
    );

    /* // Get the expired shares to send notifications
    const expiredShares = await FileShare.find({
      isActive: false,
      expiresAt: { $lt: now }
    }); */


    return result.nModified || 0;
  } catch (error) {
    console.error('Error marking expired file shares:', error);
    throw error;
  }
};

// Update a file share
export const updateFileShare = async (fileShareId, userId, updateData) => {
  try {
    const fileShare = await FileShare.findOne({ 
      _id: fileShareId,
      owner: userId
    });

    if (!fileShare) {
      throw new Error('File share not found or you are not the owner');
    }

    // Only allow updating specific fields
    const allowedUpdates = [
      'albumName', 
      'albumDescription', 
      'isPasswordProtected', 
      'password',
      'expiresAt'
    ];
    
    // Process updates
    for (const [key, value] of Object.entries(updateData)) {
      if (allowedUpdates.includes(key)) {
        // Special handling for password
        if (key === 'password' && value) {
          fileShare.password = await bcrypt.hash(value, 10);
          fileShare.isPasswordProtected = true;
        } 
        // Special handling for removing password protection
        else if (key === 'isPasswordProtected' && value === false) {
          fileShare.password = null;
          fileShare.isPasswordProtected = false;
        }
        // Handle expiration date
        else if (key === 'expiresAt') {
          const maxExpirationDays = 7;
          const expiresAt = new Date();
          const expirationDays = Math.min(value, maxExpirationDays);
          expiresAt.setDate(expiresAt.getDate() + expirationDays);
          fileShare.expiresAt = expiresAt;
        }
        // Handle other fields
        else {
          fileShare[key] = value;
        }
      }
    }

    await fileShare.save();
    
    return fileShare;
  } catch (error) {
    console.error('Error updating file share:', error);
    throw error;
  }
};

export const updateFileInShare = async (fileShareId, fileId, userId) => {
  try {
    const fileShare = await FileShare.findOne({ _id: fileShareId, owner: userId });

    if (!fileShare) {
      throw new Error('File share not found or you are not the owner');
    }

    const fileToUpdate = fileShare.files.find(file => file.fileId === fileId);
    if (!fileToUpdate) {
      throw new Error('File not found in the share');
    }

    fileToUpdate.isActive = !fileToUpdate.isActive;
    await fileShare.save();

    return fileShare;
  } catch (error) {
    console.error('Error updating file in share:', error);
    throw error;
  }
}