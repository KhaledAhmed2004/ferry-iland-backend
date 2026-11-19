import colors from 'colors';
import { JwtPayload } from 'jsonwebtoken';
import { Server } from 'socket.io';
import { logger } from '../shared/logger';
import { jwtHelper } from './jwtHelper';
import config from '../config';

/**
 * Every authenticated socket joins its own room, so a server-side event can be
 * delivered to one user with `io.to(USER_ROOM(userId)).emit(...)` — never a
 * bare `io.emit`, which would broadcast to every connected client.
 */
export const USER_ROOM = (userId: string) => `user::${userId}`;

const socket = (io: Server) => {
  io.on('connection', socket => {
    try {
      // STEP 1 — Authenticate the connection
      const token =
        (socket.handshake.auth as Record<string, unknown> | undefined)?.token ||
        (socket.handshake.query as Record<string, unknown> | undefined)?.token;

      if (!token || typeof token !== 'string') {
        logger.warn(
          colors.yellow('Socket connection without token. Disconnecting.'),
        );
        return socket.disconnect(true);
      }

      let payload: JwtPayload;
      try {
        payload = jwtHelper.verifyToken(token, config.jwt.jwt_secret as string);
      } catch {
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

      // STEP 2 — Join the personal room
      socket.join(USER_ROOM(userId));
      logger.info(
        colors.blue(`✅ User ${userId} connected & joined ${USER_ROOM(userId)}`),
      );
      logEvent('socket_connected', `for user_id: ${userId}`);

      // STEP 3 — Handle disconnect
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
