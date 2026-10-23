package pink.teezlabs.mcdiscord;

import java.util.ArrayList;
import java.util.List;

import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundCustomChatCompletionsPacket;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

/**
 * Keeps a list of Discord names that the MC-Discord bot pushes over RCON and hands it to every
 * player as custom chat completions, so typing @Te then Tab in chat completes to @Teez.
 */
@Mod(McDiscord.MOD_ID)
public class McDiscord {
    public static final String MOD_ID = "mcdiscord";

    private static final List<String> names = new ArrayList<>();

    public McDiscord() {
        NeoForge.EVENT_BUS.addListener(McDiscord::registerCommands);
        NeoForge.EVENT_BUS.addListener(McDiscord::onLogin);
    }

    private static void registerCommands(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("mcdiscord")
            .requires(source -> source.hasPermission(Commands.LEVEL_OWNERS))
            .then(Commands.literal("names")
                .then(Commands.literal("clear")
                    .executes(ctx -> clear(ctx.getSource())))
                .then(Commands.literal("add")
                    .then(Commands.argument("name", StringArgumentType.greedyString())
                        .executes(ctx -> add(ctx.getSource(), StringArgumentType.getString(ctx, "name")))))));
    }

    private static int clear(CommandSourceStack source) {
        if (!names.isEmpty()) {
            broadcast(source, ClientboundCustomChatCompletionsPacket.Action.REMOVE, List.copyOf(names));
            names.clear();
        }
        // The bot checks for this reply to tell that the mod is installed
        source.sendSuccess(() -> Component.literal("mcdiscord: cleared"), false);
        return 1;
    }

    private static int add(CommandSourceStack source, String name) {
        if (!names.contains(name)) {
            names.add(name);
            broadcast(source, ClientboundCustomChatCompletionsPacket.Action.ADD, List.of(name));
        }
        source.sendSuccess(() -> Component.literal("mcdiscord: added " + name), false);
        return 1;
    }

    private static void broadcast(CommandSourceStack source, ClientboundCustomChatCompletionsPacket.Action action, List<String> entries) {
        source.getServer().getPlayerList().broadcastAll(new ClientboundCustomChatCompletionsPacket(action, entries));
    }

    private static void onLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (event.getEntity() instanceof ServerPlayer player && !names.isEmpty()) {
            player.connection.send(new ClientboundCustomChatCompletionsPacket(
                ClientboundCustomChatCompletionsPacket.Action.ADD, List.copyOf(names)));
        }
    }
}
