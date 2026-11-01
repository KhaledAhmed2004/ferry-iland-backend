import colors from 'colors';
import { JwtPayload } from 'jsonwebtoken';
import { Server } from 'socket.io';
import { logger } from '../shared/logger';
import { jwtHelper } from './jwtHelper';
import config from '../config';
import prisma from '../shared/prisma';

const isValidId = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

// Room Name Generators
const USER_ROOM = (userId: string) => `user::${userId}`;
const CHAT_ROOM = (chatId: string) => `chat::${chatId}`;
const COMMUNITY_ROOM = (serviceArea: string) => `community::${serviceArea}`;

// Main Socket Handler
const socket = (io: Server) => {
  io.on('connection', async socket => {
    try {
      // STEP 1 — Authenticate Socket Connection
      const token =
        (socket.handshake.auth as any)?.token ||
        (socket.handshake.query as any)?.token;

      if (!token || typeof token !== 'string') {
        logger.warn(
          colors.yellow('Socket connection without token. Disconnecting.'),
        );
        return socket.disconnect(true);
      }

      let payload: JwtPayload;
      try {
        payload = jwtHelper.verifyToken(token, config.jwt.jwt_secret as string);
      } catch (err) {
        logger.warn(
          colors.red('Invalid JWT on socket connection. Disconnecting.'),
        );
        return socket.disconnect(true);
      }

      const userId = payload?.id as string;
      if (!userId) {
        logger.warn(colors.red('JWT payload missing id. Disconnecting.'));
        return socket.disconnect(true);
      }

      // STEP 2 — Join Personal Room
      socket.join(USER_ROOM(userId));
      logger.info(
        colors.blue(
          `✅ User ${userId} connected & joined ${USER_ROOM(userId)}`,
        ),
      );
      logEvent('socket_connected', `for user_id: ${userId}`);

      // Auto-join community room based on user's service area has been removed
      // (Legacy serviceArea field was removed in Slice 1)

      // STEP 3 — Handle Chat Room Join / Leave Events

      // Chat Room Join / Leave Events
      socket.on('JOIN_CHAT', async (data: unknown) => {
        const chatId = (data as any)?.chatId;
        if (!isValidId(chatId)) return;
        // Security: Ensure only chat participants can join the room
        const allowed = await prisma.chatParticipant.findFirst({
          where: { chatId, userId },
          select: { id: true },
        });
        if (!allowed) {
          logEvent('JOIN_CHAT_DENIED', `for chat_id: ${chatId}`);
          return;
        }
        socket.join(CHAT_ROOM(chatId));
        logEvent('JOIN_CHAT', `for chat_id: ${chatId}`);
        logger.info(
          colors.green(`User ${userId} joined chat room ${CHAT_ROOM(chatId)}`),
        );
      });

      socket.on('LEAVE_CHAT', async (data: unknown) => {
        const chatId = (data as any)?.chatId;
        if (!isValidId(chatId)) return;
        // Guard: Only allow leaving rooms the socket actually joined
        if (!socket.rooms.has(CHAT_ROOM(chatId))) {
          logEvent('LEAVE_CHAT_DENIED', `for chat_id: ${chatId}`);
          return;
        }
        socket.leave(CHAT_ROOM(chatId));
        logEvent('LEAVE_CHAT', `for chat_id: ${chatId}`);
        logger.info(
          colors.yellow(`User ${userId} left chat room ${CHAT_ROOM(chatId)}`),
        );
      });

      socket.on('JOIN_COMMUNITY', async (data: unknown) => {
        let area = (data as any)?.serviceArea;
        // Legacy: if client doesn't send area, we no longer fallback to userDoc.serviceArea
        if (area && typeof area === 'string') {
          socket.join(COMMUNITY_ROOM(area));
          logEvent('JOIN_COMMUNITY', `for service_area: ${area}`);
          logger.info(
            colors.green(`User ${userId} joined community room ${COMMUNITY_ROOM(area)}`),
          );
        }
      });

      socket.on('LEAVE_COMMUNITY', (data: unknown) => {
        const area = (data as any)?.serviceArea;
        if (area && typeof area === 'string') {
          socket.leave(COMMUNITY_ROOM(area));
          logEvent('LEAVE_COMMUNITY', `for service_area: ${area}`);
          logger.info(
            colors.yellow(`User ${userId} left community room ${COMMUNITY_ROOM(area)}`),
          );
        }
      });

      // Generic join-room / leave-room support (used by mobile SocketService)
      const handleJoinRoom = async (data: unknown) => {
        const rawRoomId =
          typeof data === 'string'
            ? data
            : (data as any)?.roomId || (data as any)?.room;
        if (!rawRoomId || typeof rawRoomId !== 'string') return;

        if (rawRoomId.startsWith('chat::')) {
          const chatId = rawRoomId.replace('chat::', '');
          if (!isValidId(chatId)) return;
          const allowed = await prisma.chatParticipant.findFirst({
            where: { chatId, userId },
            select: { id: true },
          });
          if (!allowed) {
            logEvent('JOIN_ROOM_DENIED', `for room: ${rawRoomId}`);
            return;
          }
        }
        socket.join(rawRoomId);
        logEvent('join-room', `for room: ${rawRoomId}`);
        logger.info(colors.green(`User ${userId} joined room ${rawRoomId}`));
      };

      const handleLeaveRoom = (data: unknown) => {
        const rawRoomId =
          typeof data === 'string'
            ? data
            : (data as any)?.roomId || (data as any)?.room;
        if (!rawRoomId || typeof rawRoomId !== 'string') return;
        socket.leave(rawRoomId);
        logEvent('leave-room', `for room: ${rawRoomId}`);
        logger.info(colors.yellow(`User ${userId} left room ${rawRoomId}`));
      };

      socket.on('join-room', handleJoinRoom);
      socket.on('join_room', handleJoinRoom);
      socket.on('JOIN_ROOM', handleJoinRoom);

      socket.on('leave-room', handleLeaveRoom);
      socket.on('leave_room', handleLeaveRoom);
      socket.on('LEAVE_ROOM', handleLeaveRoom);

      // STEP 4 — Handle Disconnect Event
      socket.on('disconnect', () => {
        logger.info(colors.red(`User ${userId} disconnected`));
        logEvent('socket_disconnected', `for user_id: ${userId}`);
      });
    } catch (err) {
      logger.error(colors.red(`Socket connection error: ${String(err)}`));
      try {
        socket.disconnect(true);
      } catch (disconnectErr) {
        logger.warn(
          colors.yellow(
            `Failed to disconnect socket: ${String(disconnectErr)}`,
          ),
        );
      }
    }
  });
};

// Helper: Log formatter
const logEvent = (event: string, extra?: string) => {
  logger.info(`🔔 Event processed: ${event} ${extra || ''}`);
};

export const socketHelper = { socket };
