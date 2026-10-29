import qrcode from 'qrcode-generator';

/**
 * The SVG namespace, for making SVG elements
 */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * The light border every QR code needs around it, in modules, so scanners can find it
 */
const QUIET_ZONE = 4;

/**
 * Draws text as a QR code, in the page itself: the text is never put in an address or sent anywhere,
 * so it can hold a secret, such as the otpauth:// URI that sets up an authenticator app. It is dark on
 * white whatever the page's theme, since scanners expect that
 *
 * @param text The text
 * @param label What the code is, for screen readers
 * @return The code, as an SVG element that scales to fit its container
 */
export function drawQrCode(text: string, label: string): SVGSVGElement
{
	// Type 0 picks the smallest size that fits; level M recovers from some damage, as on a smudged screen
	const code = qrcode(0, 'M');

	code.addData(text);
	code.make();

	const modules = code.getModuleCount();
	const size = (modules + (QUIET_ZONE * 2));
	const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
	const background = document.createElementNS(SVG_NAMESPACE, 'rect');
	const dark = document.createElementNS(SVG_NAMESPACE, 'path');
	const steps: string[] = [];

	for (let row = 0; row < modules; row++)
	{
		for (let column = 0; column < modules; column++)
		{
			if (code.isDark(row, column))
			{
				steps.push(`M${column + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
			}
		}
	}

	svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
	svg.setAttribute('role', 'img');
	svg.setAttribute('aria-label', label);
	svg.setAttribute('shape-rendering', 'crispEdges');
	svg.classList.add('qr-code');
	background.setAttribute('width', String(size));
	background.setAttribute('height', String(size));
	background.setAttribute('fill', '#ffffff');
	dark.setAttribute('d', steps.join(''));
	dark.setAttribute('fill', '#000000');
	svg.append(background, dark);

	return(svg);
}
