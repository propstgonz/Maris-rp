import { SlashCommandBuilder } from 'discord.js';
import HUIR from '../../subcommands/attack/npc.js';

export default {
  data: HUIR.build(new SlashCommandBuilder()),
  execute: HUIR.execute,
};
