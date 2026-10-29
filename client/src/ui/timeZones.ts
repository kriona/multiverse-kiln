import type { ComboboxChoice } from './ComboboxList';

/**
 * Major cities that searching for a time zone finds, by the time zones they're in, for cities whose
 * time zone is named after another city. Each entry lists every name browsers give the time zone,
 * since some still use older names (Asia/Calcutta for Asia/Kolkata)
 */
const TIME_ZONE_CITIES: readonly [zones: readonly string[], cities: readonly string[]][] = [
	[['America/New_York'], ['Washington', 'Boston', 'Philadelphia', 'Atlanta', 'Miami', 'Orlando', 'Charlotte', 'Pittsburgh', 'Baltimore', 'Cleveland', 'Columbus', 'Tampa', 'Raleigh']],
	[['America/Toronto', 'America/Montreal'], ['Ottawa', 'Montreal', 'Quebec City']],
	[['America/Chicago'], ['Dallas', 'Houston', 'San Antonio', 'Austin', 'Minneapolis', 'St. Louis', 'Kansas City', 'New Orleans', 'Nashville', 'Milwaukee', 'Oklahoma City', 'Memphis']],
	[['America/Denver'], ['Salt Lake City', 'Albuquerque', 'El Paso']],
	[['America/Edmonton'], ['Calgary']],
	[['America/Phoenix'], ['Tucson', 'Arizona']],
	[['America/Los_Angeles'], ['San Francisco', 'San Jose', 'San Diego', 'Seattle', 'Portland', 'Las Vegas', 'Sacramento', 'Oakland']],
	[['America/Vancouver'], ['Victoria']],
	[['Pacific/Honolulu'], ['Hawaii']],
	[['America/Regina'], ['Saskatoon']],
	[['America/Puerto_Rico'], ['San Juan']],
	[['America/Mexico_City'], ['Guadalajara', 'Puebla']],
	[['America/Bogota'], ['Medellín', 'Cali']],
	[['America/Sao_Paulo'], ['Rio de Janeiro', 'Brasília', 'Belo Horizonte', 'Curitiba', 'Porto Alegre']],
	[['America/Argentina/Buenos_Aires', 'America/Buenos_Aires'], ['Buenos Aires']],
	[['Europe/London'], ['Manchester', 'Birmingham', 'Liverpool', 'Edinburgh', 'Glasgow', 'Leeds', 'Bristol', 'Cardiff', 'Belfast']],
	[['Europe/Dublin'], ['Cork']],
	[['Europe/Paris'], ['Marseille', 'Lyon', 'Toulouse', 'Nice', 'Bordeaux', 'Lille']],
	[['Europe/Berlin'], ['Hamburg', 'Munich', 'München', 'Cologne', 'Köln', 'Frankfurt', 'Stuttgart', 'Düsseldorf', 'Leipzig', 'Dresden']],
	[['Europe/Madrid'], ['Barcelona', 'Valencia', 'Seville', 'Bilbao']],
	[['Europe/Rome'], ['Milan', 'Naples', 'Turin', 'Florence', 'Venice', 'Bologna']],
	[['Europe/Amsterdam'], ['Rotterdam', 'The Hague', 'Utrecht']],
	[['Europe/Brussels'], ['Antwerp']],
	[['Europe/Zurich'], ['Geneva', 'Basel', 'Bern']],
	[['Europe/Prague'], ['Brno']],
	[['Europe/Warsaw'], ['Kraków', 'Wrocław', 'Gdańsk']],
	[['Europe/Stockholm'], ['Gothenburg']],
	[['Europe/Oslo'], ['Bergen']],
	[['Europe/Athens'], ['Thessaloniki']],
	[['Europe/Istanbul'], ['Ankara', 'Izmir']],
	[['Europe/Moscow'], ['Saint Petersburg']],
	[['Europe/Kyiv', 'Europe/Kiev'], ['Kyiv', 'Kharkiv', 'Odesa', 'Lviv']],
	[['Europe/Lisbon'], ['Porto']],
	[['Africa/Cairo'], ['Alexandria', 'Giza']],
	[['Africa/Lagos'], ['Abuja', 'Ibadan', 'Kano']],
	[['Africa/Johannesburg'], ['Cape Town', 'Durban', 'Pretoria']],
	[['Africa/Nairobi'], ['Mombasa']],
	[['Africa/Casablanca'], ['Rabat', 'Marrakesh']],
	[['Asia/Dubai'], ['Abu Dhabi']],
	[['Asia/Riyadh'], ['Jeddah', 'Mecca']],
	[['Asia/Karachi'], ['Lahore', 'Islamabad']],
	[['Asia/Kolkata', 'Asia/Calcutta'], ['Kolkata', 'Mumbai', 'Delhi', 'New Delhi', 'Bengaluru', 'Bangalore', 'Chennai', 'Hyderabad', 'Pune', 'Ahmedabad']],
	[['Asia/Kathmandu', 'Asia/Katmandu'], ['Kathmandu']],
	[['Asia/Yangon', 'Asia/Rangoon'], ['Yangon']],
	[['Asia/Ho_Chi_Minh', 'Asia/Saigon'], ['Ho Chi Minh City', 'Saigon', 'Hanoi']],
	[['Asia/Manila'], ['Quezon City', 'Cebu']],
	[['Asia/Shanghai'], ['Beijing', 'Shenzhen', 'Guangzhou', 'Chengdu', 'Wuhan', 'Hangzhou', 'Chongqing']],
	[['Asia/Seoul'], ['Busan', 'Incheon']],
	[['Asia/Tokyo'], ['Osaka', 'Kyoto', 'Yokohama', 'Nagoya', 'Sapporo', 'Fukuoka']],
	[['Asia/Jerusalem'], ['Tel Aviv', 'Haifa']],
	[['Australia/Sydney'], ['Canberra', 'Newcastle']],
	[['Australia/Brisbane'], ['Gold Coast']],
	[['Pacific/Auckland'], ['Wellington', 'Christchurch']],
	[['UTC'], ['GMT', 'Coordinated Universal Time']]
];

/**
 * The cities searching finds in each time zone, by every name of the time zone
 */
const citiesByZone = new Map(TIME_ZONE_CITIES.flatMap(([zones, cities]) => zones.map((zone) => [zone, cities] as const)));

/**
 * Every time zone the browser knows, named after its city, with its name and offset from UTC in the
 * page's language as the detail, sorted by offset and then name. Searching finds a time zone by its
 * city, its full name (Europe/Paris), its name in the page's language (Central European Time), and the
 * major cities in it
 *
 * @param locale The page's language
 * @return The choices
 */
export function timeZoneChoices(locale: string): ComboboxChoice[]
{
	const now = new Date();

	return([...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC'])]
		.map((zone) =>
		{
			const { city, name, offset } = describeTimeZone(zone, locale, now);

			return({
				// Read in English, whose digits the pattern matches
				minutes: offsetMinutes(zonePart(zone, 'en-US', 'shortOffset', now)),
				choice: {
					value: zone,
					name: city,
					detail: [name, offset]
						.filter((part) => (part !== undefined))
						.join(' · '),
					keywords: [zone, ...(citiesByZone.get(zone) ?? [])]
				}
			});
		})
		.sort((first, second) => ((first.minutes - second.minutes) || first.choice.name.localeCompare(second.choice.name, locale)))
		.map(({ choice }) => choice));
}

/**
 * What a time zone is called
 */
export interface TimeZoneDescription
{
	/**
	 * The city it's named after, such as Los Angeles for America/Los_Angeles
	 */
	city: string;

	/**
	 * Its name in the page's language, such as Pacific Time, or undefined when it has none of its own
	 */
	name: string | undefined;

	/**
	 * Its offset from UTC in the page's language, such as GMT-7, or undefined when the browser has none
	 */
	offset: string | undefined;
}

/**
 * What a time zone is called, in the page's language
 *
 * @param zone The time zone, such as America/Los_Angeles
 * @param locale The page's language
 * @param date When, which decides the offset during daylight saving time
 * @return Its city, name and offset
 */
export function describeTimeZone(zone: string, locale: string, date: Date): TimeZoneDescription
{
	const offset = zonePart(zone, locale, 'shortOffset', date);
	const generic = zonePart(zone, locale, 'longGeneric', date);

	return({
		city: (zone.split('/').pop() ?? zone).replaceAll('_', ' '),

		// A time zone without a name of its own is named by its offset instead
		name: (((generic === undefined) || (generic === offset) || /^(GMT|UTC)([+\-−]|$)/.test(generic)) ? undefined : generic),
		offset
	});
}

/**
 * One way of naming a time zone, as dates are formatted in it
 *
 * @param zone The time zone
 * @param locale The page's language
 * @param style How to name it: shortOffset for its offset from UTC (GMT-7), longGeneric for its name (Pacific Time)
 * @param date When, which decides the offset during daylight saving time
 * @return The name, or undefined when the browser has none
 */
function zonePart(zone: string, locale: string, style: 'shortOffset' | 'longGeneric', date: Date): string | undefined
{
	return(new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: style })
		.formatToParts(date)
		.find((part) => (part.type === 'timeZoneName'))?.value);
}

/**
 * The minutes an offset such as GMT+5:30 is ahead of UTC, for sorting
 *
 * @param offset The offset as shortOffset formats it in English, or undefined
 * @return The minutes, or 0 for GMT and an offset that can't be read
 */
function offsetMinutes(offset: string | undefined): number
{
	const match = /([+\-−])(\d{1,2})(?::(\d{2}))?/.exec(offset ?? '');

	if (!match)
	{
		return(0);
	}

	const minutes = ((Number(match[2]) * 60) + Number(match[3] ?? 0));

	return(((match[1] === '+') ? minutes : -minutes));
}
