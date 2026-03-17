export type TrimbleRegionId = "na" | "eu" | "asia";

export interface TrimbleRegion {
	readonly id: TrimbleRegionId;
	readonly label: string;
	readonly host: string;
}

export const TRIMBLE_REGIONS: Readonly<Record<TrimbleRegionId, TrimbleRegion>> =
	{
		na: {
			id: "na",
			label: "North America",
			host: "https://app.connect.trimble.com",
		},
		eu: {
			id: "eu",
			label: "Europe",
			host: "https://app21.connect.trimble.com",
		},
		asia: {
			id: "asia",
			label: "Asia",
			host: "https://app31.connect.trimble.com",
		},
	};
