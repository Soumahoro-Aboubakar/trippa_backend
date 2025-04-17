import {
  createFileShare,
  accessFileShare,
  getUserFileShares,
  renewFileShare,
  updateFileShare,
  updateFileInShare,
} from "../services/fileShareService.js";
import FileShare from "../models/fileShare.model.js";

export const setupFileShareSocket = (socket) => {
  // Create a new file share
  socket.on("fileShare:create", async (data, callback) => {
    try {
      if (!socket.userData || !socket.userData._id) {
        return callback({ success: false, error: "Authentication required" });
      }

      const { fileData, shareOptions } = data;

      // Validate required data
      if (!fileData) {
        return callback({ success: false, error: "File data is required" });
      }

      const fileShare = await createFileShare(
        { userId: socket.userData._id },
        fileData,
        shareOptions || {}
      );

      callback({
        success: true,
        fileShare: {
          _id: fileShare._id,
          accessCode: fileShare.accessCode,
          isPasswordProtected: fileShare.isPasswordProtected,
          expiresAt: fileShare.expiresAt,
          isAlbum: fileShare.isAlbum,
          albumName: fileShare.albumName,
          files: fileShare.files.map((file) => ({
            fileName: file.fileName,
            fileId: file.fileId,
            mediaSize: file.mediaSize,
            mimeType: file.mimeType,
          })),
        },
      });
    } catch (error) {
      console.error("Error creating file share:", error);
      callback({
        success: false,
        error: error.message || "Failed to create file share",
      });
    }
  });

  // Access a shared file
  socket.on("fileShare:access", async (data, callback) => {
    try {
      const { accessCode, password } = data;

      if (!accessCode) {
        return callback({ success: false, error: "Access code is required" });
      }

      const userData = {
        userId: socket.userData._id,
      };

      const result = await accessFileShare(accessCode, password, userData);

      // If password is required but not provided or invalid
      if (result.requiresPassword) {
        return callback({
          success: false,
          requiresPassword: true,
          error: "password is required",
        });
      }
      /* 
      // Notify the owner if they're online
      const ownerSocketId = global.connectedUsers.get(result.owner.toString());
      if (ownerSocketId) {
        io.to(ownerSocketId).emit('fileShare:accessed', {
          fileShareId: result._id,
          accessedAt: new Date(),
          accessedBy: userData.userId || 'Anonymous'
        });
      } */

      callback({
        success: true,
        fileShare: {
          _id: result._id,
          isAlbum: result.isAlbum,
          albumName: result.albumName,
          albumDescription: result.albumDescription,
          files: result.files.map((file) => ({
            fileName: file.fileName,
            fileId: file.fileId,
            mediaPath: file.mediaPath,
            mediaSize: file.mediaSize,
            mediaDuration: file.mediaDuration,
            mimeType: file.mimeType,
          })),
        },
      });
    } catch (error) {
      console.error("Error accessing file share:", error);
      callback({ error: error.message || "Failed to access file share" });
    }
  });

  // Get user's file shares
  socket.on("fileShare:getUserShares", async (data, callback) => {
    try {
      if (!socket.userData || !socket.userData._id) {
        return callback({ success: false, error: "Authentication required" });
      }

      const fileShares = await getUserFileShares(socket.userData._id);

      callback({
        success: true,
        fileShares: fileShares.map((share) => ({
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
          files: share.files.map((file) => ({
            fileName: file.fileName,
            fileId: file.fileId,
            mediaSize: file.mediaSize,
            mimeType: file.mimeType,
          })),
        })),
      });
    } catch (error) {
      console.error("Error getting user file shares:", error);
      callback({
        success: false,
        error: error.message || "Failed to get file shares",
      });
    }
  });

  // Renew an expired file share
  socket.on("fileShare:renew", async (data, callback) => {
    try {
      if (!socket.userData || !socket.userData._id) {
        return callback({ error: "Authentication required" });
      }

      const { fileShareId, expirationDays } = data;

      if (!fileShareId) {
        return callback({ error: "File share ID is required" });
      }

      const renewedShare = await renewFileShare(
        fileShareId,
        socket.userData._id,
        expirationDays
      );

      callback({
        success: true,
        fileShare: {
          _id: renewedShare._id,
          expiresAt: renewedShare.expiresAt,
          isActive: renewedShare.isActive,
        },
      });
    } catch (error) {
      console.error("Error renewing file share:", error);
      callback({ error: error.message || "Failed to renew file share" });
    }
  });

  // Delete a file share
  socket.on("fileShare:delete", async (data, callback) => {
    try {
      if (!socket.userData || !socket.userData._id) {
        return callback({ error: "Authentication required" });
      }

      const { fileShareId } = data;

      if (!fileShareId) {
        return callback({ error: "File share ID is required" });
      }

      const fileShare = await FileShare.findOne({
        _id: fileShareId,
        owner: socket.userData._id,
      });

      if (!fileShare) {
        return callback({
          error: "File share not found or you are not the owner",
        });
      }

      await FileShare.deleteOne({ _id: fileShareId });

      callback({ success: true });
    } catch (error) {
      console.error("Error deleting file share:", error);
      callback({ error: error.message || "Failed to delete file share" });
    }
  });

  // Update a file share
  socket.on("fileShare:update", async (data, callback) => {
    try {
      if (!socket.userData || !socket.userData._id) {
        return callback({ success: false, error: "Authentication required" });
      }

      const { fileShareId, updateData } = data;

      if (!fileShareId) {
        return callback({ success: false, error: "File share ID is required" });
      }

      if (!updateData || Object.keys(updateData).length === 0) {
        return callback({ success: false, error: "Update data is required" });
      }

      const updatedShare = await updateFileShare(
        fileShareId,
        socket.userData._id,
        updateData
      );

      callback({
        success: true,
        fileShare: {
          _id: updatedShare._id,
          accessCode: updatedShare.accessCode,
          isPasswordProtected: updatedShare.isPasswordProtected,
          expiresAt: updatedShare.expiresAt,
          isAlbum: updatedShare.isAlbum,
          albumName: updatedShare.albumName,
          albumDescription: updatedShare.albumDescription,
        },
      });
    } catch (error) {
      console.error("Error updating file share:", error);
      callback({
        success: false,
        error: error.message || "Failed to update file share",
      });
    }
  });

  // Update a file within a file share
  socket.on("fileShare:updateFile", async (data, callback) => {
    try {
      if (!socket.userData || !socket.userData._id) {
        return callback({ success: false, error: "Authentication required" });
      }

      const { fileShareId, fileId, updateData } = data;

      if (!fileShareId) {
        return callback({ success: false, error: "File share ID is required" });
      }

      if (!fileId) {
        return callback({ success: false, error: "File ID is required" });
      }

      if (!updateData || Object.keys(updateData).length === 0) {
        return callback({ success: false, error: "Update data is required" });
      }

      const updatedFile = await updateFileInShare(
        fileShareId,
        socket.userData._id,
        fileId,
        updateData
      );

      callback({
        success: true,
        file: {
          fileId: updatedFile.fileId,
          fileName: updatedFile.fileName,
          mediaPath: updatedFile.mediaPath,
          mediaSize: updatedFile.mediaSize,
          mediaDuration: updatedFile.mediaDuration,
          mimeType: updatedFile.mimeType,
        },
      });
    } catch (error) {
      console.error("Error updating file in share:", error);
      callback({
        success: false,
        error: error.message || "Failed to update file",
      });
    }
  });
};
