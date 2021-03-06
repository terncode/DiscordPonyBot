import { Guild, GuildMember, Collection, TextChannel, Client } from 'discord.js';
import { Language } from '../language/langTypes';
import { ENGLISH } from '../language/English';
import { config } from '..';
import { MongoGuild } from './databaseSchemas';
import { guildFind, getGuildsInDataBase, removeGuildFromDataBase } from './database';
import * as path from 'path';
import * as fs from 'fs';
import { removeSomeItemFromArray } from './util';
import { reportErrorToOwner } from './errors';
const languageFolder = path.join(__dirname, '../../languages');

interface Guilds {
    [key: string]: {
        prefix: string;
        language: string;
        swearPrevention: boolean;
        autoConversion: boolean;
    };
}
interface Languages {
    [key: string]: Language;
}

const languages: Languages = {};
languages[ENGLISH.iso] = ENGLISH;

const guilds: Guilds = {};

export const ignoredChannels: string[] = [];
export const doNotReactChannels: string[] = [];
export const preventSwearsChannels: string[] = [];
const ignore = 'ignore';
const doNotReact = 'do-not-react';
const preventSwears = 'prevent-swears'; 


export function getPrefix(guild?: Guild | null) {
    if (!guild) return config.PREFIX;
    return guilds[guild.id].prefix || config.PREFIX;
}

export function getLanguage(guild?: Guild | null): Language {
    if (!guild) return ENGLISH;
    const iso = guilds[guild.id].language;
    return languages[iso] || ENGLISH;
}

export async function createGuildDataBase(guild: Guild) {
    const id = guild.id;
    if (!guild.id) throw new Error('Guild does not have ID');

    const mongoGuild = await guildFind(id);
    if (mongoGuild) return false;
    guilds[guild.id] = {
        language: ENGLISH.iso,
        prefix: config.PREFIX,
        autoConversion: false,
        swearPrevention: false,
    };
    const post = new MongoGuild(
        {
            id,
            language: ENGLISH.iso,
            prefix: config.PREFIX,
            swearPrevention: false,
            autoConversion: false,
            emojiReaction: true,
            imageDeliveryUpdatesChannels: [],
        });

    await post.save();
    guild.client.emit('debug', `Guild ${guild.name} | ${guild.id} has been stored in database`);
    return true;
}

export async function changeGuildPrefix(guild: Guild, prefix: string) {
    prefix = prefix.toLowerCase().replace(/ /g, '');
    const guildDB = await guildFind(guild.id);
    if (!guildDB) throw new Error('Unable to find guild');
    guildDB.prefix = prefix;
    await guildDB.save();
    guilds[guild.id].prefix = prefix;
    return prefix;
}

export async function changeGuildLanguage(guild: Guild, lang: string) {
    lang = lang.toLowerCase();

    if (languages[lang]) {
        if (guilds[guild.id].language === languages[lang].iso) return false;
        const guildDB = await guildFind(guild.id);
        if (!guildDB) throw new Error('Unable to find guild');
        guildDB.language = languages[lang].iso;
        guilds[guild.id].language = languages[lang].iso;
        await guildDB.save();
        return true;
    } else {
        const keys = Object.keys(languages);
        for (const key of keys) {
            if (languages[key].fullName.toLowerCase().replace(/ /g, '-') === lang) {
                if (guilds[guild.id].language === languages[key].iso) return false;
                const guildDB = await guildFind(guild.id);
                if (!guildDB) throw new Error('Unable to find guild');
                guildDB.language = languages[key].iso;
                guilds[guild.id].language = languages[key].iso;
                await guildDB.save();
                return true;
            }
        }
    }
}

export function loadLanguages(): Promise<void> {
    return new Promise((resolve, reject) => {
        fs.readdir(languageFolder, (err, data) => {
            if (err) return reject(err);
            for (const lang of data.filter(d => /\.json$/g.test(d))) {
                try {
                    const language: Language = require(`${path.join(__dirname, `../../languages/${lang}`)}`);
                    if (language.iso && language.fullName && verifyLanguage(language)) {
                        languages[language.iso] = language;
                    }
                } catch (_) {
                    console.error(`Language file not loaded ${lang}`);
                }
            }
            resolve();
        });
    });
}

function verifyLanguage(language: Language): boolean {
    const keys = Object.keys(ENGLISH);
    for (const key of keys) {
        // @ts-ignore
        if (!(language[key] && typeof ENGLISH[key] === typeof language[key])) {
            console.warn(`Corrupted Language ${language.fullName}`);
            return false;
        }
    }
    return true;
}

export async function enableDisableGuildAutoConversion(guild: Guild, bool: boolean): Promise<boolean> {
    if (bool === guilds[guild.id].autoConversion) return false;
    const guildDB = await guildFind(guild.id);
    if (!guildDB) throw new Error('Unable to find guild');

    guildDB.autoConversion = bool;
    guilds[guild.id].autoConversion = bool;
    await guildDB.save();
    return true;
}

export async function enableDisableGuildSwearPrevention(guild: Guild, bool: boolean) {
    if (bool === guilds[guild.id].swearPrevention) return false;
    const guildDB = await guildFind(guild.id);
    if (!guildDB) throw new Error('Unable to find guild');
    guildDB.swearPrevention = bool;
    guilds[guild.id].swearPrevention = bool;
    await guildDB.save();
    return true;
}

export function getAvailableLanguages(smallNames = false) {
    const keys = Object.keys(languages);
    const availableLanguages: string[] = [];

    for (const key of keys) {
        availableLanguages.push(languages[key].fullName.replace(/ /g, '-').toLowerCase());
        if (smallNames) availableLanguages.push(languages[key].iso.replace(/ /g, '-').toLowerCase());
    }
    return availableLanguages;
}

export async function setup(client: Client) {
    await checkForMissingGuildAndAddItToDataBase(client);
    // await garbageCollectGuildsFromDataBase(client);
    // await removeDeletedChannelsFromSubscriptions(client);
    const guildsDB = await getGuildsInDataBase();
    guildsDB.forEach(g => {
        guilds[g.id] = {
            language: g.language,
            prefix: g.prefix,
            swearPrevention: g.swearPrevention,
            autoConversion: g.autoConversion,
        };
        const channelFlags = g.channelFlags || [];
        channelFlags.forEach(raw => {
            const [id, flag] = raw.split('|');
            switch (flag) {
                case ignore:
                    ignoredChannels.push(id);
                break;
                case doNotReact:
                    doNotReactChannels.push(id);
                break;
                case preventSwears:
                    preventSwearsChannels.push(id);
                break;
                default:
                    console.error(`Unknown flag ${flag}`);
                break;
            }

        });


    });
}

async function checkForMissingGuildAndAddItToDataBase(client: Client): Promise<void> {
    const guildsDB = await getGuildsInDataBase();
    const guildIDs = guildsDB.map(g => g.id);
    const guildsClient = client.guilds.cache.map(g => g);
    for (const guildClient of guildsClient) {
        if (!guildIDs.includes(guildClient.id)) {
            await createGuildDataBase(guildClient);
        }
    }
}

export async function garbageCollectGuildsFromDataBase(client: Client) {
    const guildsDB = await getGuildsInDataBase();
    const guildsClient = client.guilds.cache.map(g => g.id);
    const removedGuilds: string[] = [];

    for (const guildDB of guildsDB) {
        if (!guildsClient.includes(guildDB.id)) {
            await removeGuildFromDataBase(guildDB.id);
            removedGuilds.push(guildDB.id);
        }
    }
    return removedGuilds;
}

export async function removeDeletedChannelsFromSubscriptions(client: Client) {
    const guildsDB = await getGuildsInDataBase();
    let shouldUpdate = false;
    const removedChannelsId: string[] = [];

    for (const guildDB of guildsDB) {
        const guild = client.guilds.cache.find(g => g.id === guildDB.id);
        if (!guild) continue;
        const channelsIDs = guild.channels.cache.filter(c => c.type === 'text').map(c => c.id);


        const imageDeliveryChannels = [...guildDB.imageDeliveryChannels];
        for (const id of guildDB.imageDeliveryChannels) {
            if (!channelsIDs.includes(id)) {
                const index = imageDeliveryChannels.indexOf(id);
                if (index !== -1) {
                    imageDeliveryChannels.splice(index, 1);
                    shouldUpdate = true;
                }
                removedChannelsId.push(id);
            }
        }
        if (shouldUpdate) {
            guildDB.imageDeliveryChannels = imageDeliveryChannels;
            await guildDB.save();
        }
    }
    return removedChannelsId;
}

// returns false if it is already on list
export async function addImageDeliveryChannel(guild: Guild, channel: TextChannel) {
    if (channel.type !== 'text') throw new Error('Invalid Channel');

    const guildDB = await guildFind(guild.id);
    if (!guildDB) throw new Error('Unable to find guild');
    if (guildDB.imageDeliveryChannels.includes(channel.id)) return false;

    guildDB.imageDeliveryChannels.push(channel.id);
    await guildDB.save();
    return true;
}

export async function removeImageDeliveryChannel(guild: Guild, id: string) {
    const guildDB = await guildFind(guild.id);
    if (!guildDB) throw new Error('Unable to find guild');
    const index = guildDB.imageDeliveryChannels.indexOf(id);
    if (index === -1) return false;

    guildDB.imageDeliveryChannels.splice(index, 1);
    await guildDB.save();
    return true;
}



export async function getALLImageDeliveryChannels(client: Client) {
    const channels: TextChannel[] = [];
    const guildsDB = await getGuildsInDataBase();
    for (const guildDB of guildsDB) {
        const guild = client.guilds.cache.find(g => g.id === guildDB.id);
        if (!guild) continue;
        for (const imageDeliveryChannel of guildDB.imageDeliveryChannels) {
            const channel = guild.channels.cache.find(c => c.id === imageDeliveryChannel && c.type === 'text') as TextChannel;
            if (channel) channels.push(channel);
        }
    }
    return channels;
}

export function isSwearPreventionEnabled(guild: Guild) {
    return guilds[guild.id].swearPrevention;
}

export function isAutoConversionEnabled(guild: Guild) {
    return guilds[guild.id].autoConversion;
}

export enum ChannelFlag {
    Clear,
    DoNotReact,
    PreventSwears,
    Ignore,
} 

export async function setFlagToChannel(channel: TextChannel, flag: ChannelFlag) {
    const guildDB = await guildFind(channel.guild.id);
    if (!guildDB) throw new Error('Unable to find guild');
    const id = channel.id;
    const channelFlags = guildDB.channelFlags || [];

    switch (flag) {
        case ChannelFlag.Clear:
            guildDB.channelFlags = [];
            removeSomeItemFromArray(ignoredChannels, id);
            removeSomeItemFromArray(doNotReactChannels, id);
            removeSomeItemFromArray(preventSwearsChannels, id);
        break;
        case ChannelFlag.DoNotReact:
            if (!doNotReactChannels.includes(id)) {
                doNotReactChannels.push(id);
            }
            // eslint-disable-next-line no-case-declarations
            const dateBaseString = `${id}|${doNotReact}`;
            if (!channelFlags.includes(dateBaseString)) {
                channelFlags.push(dateBaseString);
            }
        break;
        case ChannelFlag.Ignore:
            if (!ignoredChannels.includes(id)) {
                ignoredChannels.push(id);
            }
            // eslint-disable-next-line no-case-declarations
            const dateBaseString1 = `${id}|${ignore}`;
            if (!channelFlags.includes(dateBaseString1)) {
                channelFlags.push(dateBaseString1);
            }
        break;
        case ChannelFlag.PreventSwears:
            if (!preventSwearsChannels.includes(id)) {
                preventSwearsChannels.push(id);
            }
            // eslint-disable-next-line no-case-declarations
            const dateBaseString2 = `${id}|${preventSwears}`;
            if (!channelFlags.includes(dateBaseString2)) {
                channelFlags.push(dateBaseString2);
            }
        break;
        default:
            throw new Error('Unknown channel flag');
    }
    try {
        await guildDB.save();
        return true;
    } catch (error) {
        reportErrorToOwner(channel.client, error);
        return false;
    }

}


export function findGuildMembers(query: string, guild: Guild) {
    const finders = [
        (g: GuildMember) => g.displayName === query,
        (g: GuildMember) => g.displayName.toLowerCase() === query.toLowerCase(),
        (g: GuildMember) => g.displayName.includes(query),
        (g: GuildMember) => g.displayName.toLowerCase().includes(query.toLowerCase()),
        (g: GuildMember) => g.user.username === query,
        (g: GuildMember) => g.user.username.toLowerCase() === query.toLowerCase(),
        (g: GuildMember) => g.user.tag === query,
        (g: GuildMember) => g.user.tag.toLowerCase() === query.toLowerCase(),
        (g: GuildMember) => g.user.username.includes(query),
        (g: GuildMember) => g.user.username.toLowerCase().includes(query.toLowerCase()),
        (g: GuildMember) => g.user.tag.includes(query),
        (g: GuildMember) => g.user.tag.toLowerCase().includes(query.toLowerCase()),
    ];
    let guildMember: Collection<string, GuildMember> | null = null;
    for (const finder of finders) {
        guildMember = guild.members.cache.filter(finder);
        if (guildMember.size) break;
    }
    return guildMember ? guildMember.map(g => g) : null;
}
