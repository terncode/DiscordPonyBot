import { isBotOwner, removeFirstWord, hasPermissionInChannel } from '../../until/util';
import { Message, PresenceStatusData, TextChannel } from 'discord.js';
import { checkCommand, removePrefixAndCommand, getCommandArgs } from '../../until/commandsHandler';
import { destroy, updateActivity, client } from '../..';
import { garbageCollectGuildsFromDataBase, removeDeletedChannelsFromSubscriptions } from '../../until/guild';
import { signEmbed, stringifyEmbed } from '../../until/embeds';

export function ownerCommands(message: Message): boolean {
    if (!isBotOwner(message.author)) return false;
    // const dev = process.env.NODE_ENV !== 'production';
    if (/*dev && */ checkCommand(message, ['throw.error'])) {
        message.channel.send(`Throwing error...`);
        setTimeout(() => {
            throw new Error(`Error thrown by ${message.author.tag}`);
        });
        return true;
    } else if (/*dev && */ checkCommand(message, ['promise.reject'])) {
        message.channel.send(`Rejecting promise...`);
        Promise.reject();
        return true;
    } else if (checkCommand(message, ['set.status'])) {
        setStatus(message);
        return true;
    } else if (checkCommand(message, ['shutdown'])) {
        onShutDown(message);
        return true;
    } else if (checkCommand(message, ['set.presence'])) {
        setPresence(message);
        return true;
    } else if (checkCommand(message, ['eval'])) {
        onEval(message);
        return true;
    } else if (checkCommand(message, ['clean.database'])) {
        cleanDatabase(message);
        return true;
    } else if (checkCommand(message, ['clean.database.subscriptions'])) {
        cleanSubscriptionChannelsDataBase(message);
        return true;
    } else if (checkCommand(message, ['announce'])) {
        announce(message);
        return true;
    }

    else return false;
}

function setStatus(message: Message) {
    const status = removePrefixAndCommand(message).toLowerCase();
    if (['online', 'idle', 'invisible', 'dnd'].includes(status)) {
        const s = status as PresenceStatusData;
        message.client.user!.setStatus(s)
            .then(() => {
                message.channel.send(`My status has been altered`);
            }).catch(err => message.channel.send(err));
    } else {
        message.channel.send('Incorrect status you can only use `online` `idle` `invisible` `dnd`');
    }
}

function setPresence(message: Message) {
    const status = removePrefixAndCommand(message);
    if (!status) {
        updateActivity();
        return;
    }

    const args = getCommandArgs(message);
    if (['PLAYING', 'LISTENING', 'WATCHING', 'STREAMING'].includes(args[0].toUpperCase())) {
        updateActivity(removeFirstWord(status), args[0] as 'PLAYING' | 'LISTENING' | 'WATCHING' || 'STREAMING')
            .then(() => {
                message.channel.send(`activity has been altered`);
            }).catch((err: any) => {
                message.channel.send(`${err.toString()}`);
            });

        return;
    } else {
        updateActivity(status)
            .then(() => {
                if (!status) message.channel.send(`activity has been default`);
                else message.channel.send(`activity has been altered`);
            }).catch((err: any) => {
                message.channel.send(`${err.toString()}`);
            });
    }
}

function onEval(message: Message) {
    console.warn(`Executing eval ${message.author.tag}`);
    const { client } = message;
    const code = removePrefixAndCommand(message);
    const isCode = code.match(/```javascript[ \n\t\S\s\w\W\r]*```/g);
    let result: any;
    try {
        if (client) console.debug();
        if (isCode) result = eval(isCode[0].slice(13, -3));
        else result = eval(code);
    } catch (error) {
        const err = error.toString();
        if (err) message.channel.send(err);
        else message.channel.send('Code error');
        return;
    }
    if (result) {
        message.channel.send(result.toString().slice(0, 2000));
    } else {
        message.channel.send('no results');
    }
}

async function onShutDown(message: Message) {
    await message.channel.send(`shutingDown...`);
    destroy();
}

async function cleanDatabase(message: Message) {
    try {
        const removed = await garbageCollectGuildsFromDataBase(message.client);
        message.channel.send(`Total removed Inactive guilds: ${removed.length}`);
    } catch (error) {
        message.channel.send(error.stack);
    }
}

async function cleanSubscriptionChannelsDataBase(message: Message) {
    try {
        const removed = await removeDeletedChannelsFromSubscriptions(message.client);
        message.channel.send(`Removed inactive channels: ${removed.length}`);
    } catch (error) {
        message.channel.send(error.stack);
    }
}
async function announce(message: Message) {
    const content = removePrefixAndCommand(message);
    const guilds = client.guilds.cache.map(g => g);
    let announcmentSent = 0;

    for (const guild of guilds) {
        const channel = guild.channels.cache.find(c => c.name === 'pony-logs' && c.type === 'text') as TextChannel;
        if (channel && hasPermissionInChannel(channel, 'SEND_MESSAGES')) {
            try {
                const embed = signEmbed(message.client);
                embed.setAuthor(message.author.tag, message.author.avatarURL() || undefined);
                embed.setTitle('Announcment');
                embed.setColor('BLUE');
                embed.setDescription(content);
                if (hasPermissionInChannel(channel, 'EMBED_LINKS')) {
                    await channel.send(embed);
                } else {
                    await channel.send(stringifyEmbed(embed, message.client, guild));
                }
                announcmentSent++;
            } catch (_) { /* ignore */ }
        }
    }
    message.channel.send(`Sent ${announcmentSent} messages`);
}
