import { connect } from "trimble-connect-workspace-api";
import type {
	WorkspaceApi,
	CommandEventData,
} from "trimble-connect-workspace-api";

export type CommandHandler = (command: string) => void | Promise<void>;

export async function connectToTrimble(
	target: Window,
	onCommand: CommandHandler,
): Promise<WorkspaceApi> {
	return connect(target, (event: string, data: CommandEventData) => {
		if (event === "extension.command") {
			onCommand(data?.data ?? "");
		}
	});
}
