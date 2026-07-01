import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';

const commands = [
  new SlashCommandBuilder()
    .setName('setup-server')
    .setDescription('Buat role, channel, panel verify, panel ticket, dan payment WS Store.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('refresh-panels')
    .setDescription('Refresh tombol ticket sesuai jam operasional.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('add-transaction')
    .setDescription('Tambah transaksi manual dan update tier customer.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option.setName('buyer').setDescription('Pembeli').setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName('amount').setDescription('Nominal rupiah').setRequired(true).setMinValue(0)
    )
    .addStringOption((option) =>
      option.setName('product').setDescription('Produk').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('payment').setDescription('Metode pembayaran').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('customer')
    .setDescription('Cek total transaksi dan tier customer.')
    .addUserOption((option) =>
      option.setName('user').setDescription('Customer yang dicek').setRequired(false)
    )
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(config.discordToken);

await rest.put(
  Routes.applicationGuildCommands(config.clientId, config.guildId),
  { body: commands }
);

console.log(`Registered ${commands.length} slash commands for ${config.storeName}.`);
