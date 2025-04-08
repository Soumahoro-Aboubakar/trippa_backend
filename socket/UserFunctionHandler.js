

export const userIsConnected = (userId, connectedUsers) => {
    // Vérifie si l'utilisateur est connecté en vérifiant si son ID est présent dans la liste des utilisateurs connectés
    return connectedUsers.has(userId);
}

/*************  ✨ Codeium Command 🌟  *************/
export const getUserSocketId = (userId, connectedUsers) => {
    return connectedUsers.get(userId.toString());

};
// Modifier sendNotificationToUsers pour envoyer les notifications individuellement
export const sendNotificationToUsers = async (io, notifications, connectedUsers) => {
    const sendPromises = notifications.map(notification => {
        const userId = notification.recipient?._id?.toString();;
        const socket = connectedUsers.get(userId);
        if (socket) {
            return io.to(socket).emit(notification.type, notification); // Envoi de la notification spécifique
        }
        return Promise.resolve();
    });
    await Promise.all(sendPromises);
};