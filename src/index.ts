import { Client, Message, PresenceStatusData } from 'discord.js';
import { Config } from './interfaces';
import { reportErrorToOwner } from './until/errors';
import { connectToDB } from './until/database';
import { setup, loadLanguages, getALLImageDeliveryChannels } from './until/guild';
import { ImageDelivery } from './other/derpibooru/imageDelivery';
import { hasPermissionInChannel } from './until/util';
import {onShutDown, setupPluginManager } from './pluginManager';

let idleTimeout: NodeJS.Timeout | undefined;
export const client = new Client();
export const version = 'v14/06/2020';
export let inviteLink: string;
export let config: Config;
export const supportServer = 'https://discord.gg/HPvbWYp';

try {
    config = require('../config.json');
} catch (_) {
    console.info('Failed to load config.json. Loading environment variables');
    config = {
        TOKEN: process.env.BOT_TOKEN || '',
        DEBUG: !!process.env.DEBUG,
        OWNER_ID: process.env.OWNER_ID,
        PREFIX: process.env.PREFIX || '-',
        DB_CONNECTION_STRING: process.env.DB_CONNECTION_STRING || ''
    };
}
if (process.env.NODE_ENV !== 'production') {
    console.log(JSON.stringify(config, undefined, 2));
}
export let shouldUpdateActivity = false;

function login(token: string) {
 return new Promise((resolve) => {
    const onReadyCallback = () => {
        client.removeListener('ready',onReadyCallback);
        onReady();
        resolve();
    };

    client.on('ready', onReadyCallback);
    client.login(token);

 });
}
async function onReady() {
    console.info(`loggined as ${client.user!.tag}`);
    console.info(`Access to ${client.guilds.cache.size} guilds`);
    inviteLink = await client.generateInvite('ADMINISTRATOR');
    if (client.user!.bot) console.info(`Invite link: ${inviteLink}`);
    updateActivity();
}

// process.on('SIGKILL', () => destroy());
process.on('beforeExit', () => destroy());
process.on('SIGINT', () => destroy());
process.on('SIGTERM', () => destroy());

process.on('uncaughtException', async (err: Error) => {
    await reportErrorToOwner(client, err);
    // destroy()
});

process.on('unhandledRejection', async err => {
    if (err) await reportErrorToOwner(client, err);
    else await reportErrorToOwner(client, Error('unhandledRejection'));
});

export function idle(message: Message) {
    if (message.author === client.user) return;
    if (idleTimeout) clearTimeout(idleTimeout);
    setStatus('online');
    idleTimeout = setTimeout(() => {
        setStatus('idle');
    }, 150000);
}

export async function setStatus(status?: PresenceStatusData): Promise<void> {
    if (!status) status = 'online';
    await client.user!.setStatus(status);
}

export async function updateActivity(text?: string, type?: number | 'PLAYING' | 'STREAMING' | 'LISTENING' | 'WATCHING') {
    if (text || type) shouldUpdateActivity = false;
    else shouldUpdateActivity = true;
    text = text || `${config.PREFIX}help in ${client.guilds.cache.size} Servers`;
    type = type || 'WATCHING';
    await client.user!.setActivity(text, { type });
}

export async function destroy() {
    await onShutDown(client);
    await client.destroy();
    process.exit(0);
}

function startServices() {
    const imageDelivery = new ImageDelivery();
    imageDelivery.on('update', async (embed, imageUrl) => {
        try {
            const channels = await getALLImageDeliveryChannels(client);
            for (const channel of channels) {
                if (hasPermissionInChannel(channel, 'SEND_MESSAGES')) {
                    if (hasPermissionInChannel(channel, 'EMBED_LINKS')) {
                        channel.send(embed);
                    } else channel.send(imageUrl);
                }
            }
        } catch (error) {
            reportErrorToOwner(client, error);
        }
    });
}

async function boot() {
    try {
        console.info('Loading languages...');
        await loadLanguages();
        console.info('Connecting to database...');
        await connectToDB(config.DB_CONNECTION_STRING);
        console.info('Connecting to discord...');
        await login(config.TOKEN);
        console.info('Setting everything up...');
        await setup(client);
        console.info('Starting services.');
        startServices();
        console.info('Done.');
        setupPluginManager(client);
    } catch (error) {
        console.error(error);
        await client.destroy();
        process.exit(1);
    }
}

boot();
