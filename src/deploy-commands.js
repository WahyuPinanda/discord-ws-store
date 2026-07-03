import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';

const serviceCommands = [
  ['order', 'Ticket order'],
  ['support', 'Ticket support'],
  ['limited', 'Limited item'],
  ['via-login', 'Via login'],
  ['via-username', 'Via username'],
  ['group-payout', 'Group payout'],
  ['gift-gamepass', 'Gift gamepass']
];

function addServiceSubcommands(command) {
  for (const [name, description] of serviceCommands) {
    command.addSubcommand((subcommand) =>
      subcommand
        .setName(name)
        .setDescription(description)
    );
  }

  return command;
}

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
    ),
  addServiceSubcommands(
    new SlashCommandBuilder()
      .setName('open')
      .setDescription('Set service WS Store menjadi OPEN.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  ),
  addServiceSubcommands(
    new SlashCommandBuilder()
      .setName('close')
      .setDescription('Set service WS Store menjadi CLOSED.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  ),
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Kelola giveaway WS Store.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Buat giveaway baru.')
        .addStringOption((option) =>
          option.setName('prize').setDescription('Hadiah giveaway, contoh: Total 2000 Robux (4 orang)').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('duration').setDescription('Durasi giveaway, contoh: 30m, 4h, 1d').setRequired(true)
        )
        .addIntegerOption((option) =>
          option.setName('winners').setDescription('Jumlah winner').setRequired(false).setMinValue(1).setMaxValue(20)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('end')
        .setDescription('Akhiri giveaway lebih cepat.')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('ID giveaway').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reroll')
        .setDescription('Undi ulang winner giveaway.')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('ID giveaway').setRequired(true).setMinValue(1)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(config.discordToken);

await rest.put(
  Routes.applicationGuildCommands(config.clientId, config.guildId),
  { body: commands }
);

console.log(`Registered ${commands.length} slash commands for ${config.storeName}.`);
