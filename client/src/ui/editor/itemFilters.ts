import { categoryItemTypes, ITEM_KINDS, itemEquipsChoices, type Ruleset } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { setOptions, type SelectOption } from '../dom';
import { formMessages } from '../formMessages';
import { itemCategoryName, itemEquipsText, itemTypeName } from '../itemNames';

/**
 * Offers a ruleset's item kinds in a kind filter, after Any, which is chosen. Used by the Items tab and
 * the dialog for choosing items
 *
 * @param select The kind filter
 * @param ruleset The universe's ruleset
 */
export function showCategoryOptions(select: HTMLSelectElement, ruleset: Ruleset): void
{
	setOptions(select, [
		anyOption(),
		...ITEM_KINDS[ruleset].categories.map((category) => ({
			value: category,
			label: itemCategoryName(category, ruleset)
		}))
	]);
	select.value = '';
}

/**
 * Offers the types of the kind chosen in a type filter, or of every kind when none is, that some item
 * listed has (ItemListPayload's types). The type chosen stays chosen while it is of the kind chosen, even
 * once no item has it, and the list says no items match
 *
 * @param categorySelect The kind filter
 * @param typeSelect The type filter
 * @param ruleset The universe's ruleset
 * @param withItems The types some item has
 */
export function showTypeOptions(categorySelect: HTMLSelectElement, typeSelect: HTMLSelectElement, ruleset: Ruleset, withItems: ReadonlySet<string>): void
{
	const category = categorySelect.value;
	const chosen = typeSelect.value;
	const types = ((category === '') ? Object.keys(ITEM_KINDS[ruleset].types) : categoryItemTypes(ruleset, category))
		.filter((type) => (withItems.has(type) || (type === chosen)));

	setOptions(typeSelect, [
		anyOption(),
		...types.map((type) => ({
			value: type,
			label: itemTypeName(type, ruleset)
		}))
	]);
	typeSelect.value = (types.includes(chosen) ? chosen : '');
}

/**
 * Offers where some item listed equips (ItemListPayload's equips) in an equips filter, after Any, in the
 * item editor's order: nowhere, one hand, two hands, then the worn places. The place chosen stays chosen
 * even once no item equips there, and the list says no items match
 *
 * @param select The equips filter
 * @param ruleset The universe's ruleset
 * @param withItems Where some item equips
 */
export function showEquipsOptions(select: HTMLSelectElement, ruleset: Ruleset, withItems: ReadonlySet<string>): void
{
	const chosen = select.value;
	const choices = itemEquipsChoices(ruleset).filter((equips) => (withItems.has(equips) || (equips === chosen)));

	setOptions(select, [
		anyOption(),
		...choices.map((equips) => ({
			value: equips,
			label: itemEquipsText(equips, ruleset)
		}))
	]);
	select.value = (choices.includes(chosen) ? chosen : '');
}

/**
 * The choice of a kind, type or equips filter that shows every item
 *
 * @return The choice
 */
function anyOption(): SelectOption
{
	return({
		value: '',
		label: t(formMessages.filterAny)
	});
}
