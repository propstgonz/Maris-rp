import { escapeHtml as esc, escapeAttr } from './html';

export interface CraftIngredient { quantity_required: number; name: string; display_name: string; emoji: string | null }
export interface CraftOption {
  recipe: { id: number; result_name: string; result_display_name: string; result_emoji: string | null; result_quantity: number };
  ingredients: CraftIngredient[];
  effectiveLaburoCost: number;
  hasTool: boolean;
}

export function craftOptionsHtml(options: CraftOption[]): string {
  if (options.length === 0) {
    return '<p class="hint">No puedes craftear nada ahora mismo — te faltan materiales, Laburo, o la construcción necesaria.</p>';
  }
  return options.map(opt => `
    <div class="tile-detail-row">
      <span class="tile-detail-row-main">
        <b>${esc(opt.recipe.result_emoji ?? '📦')} ${esc(opt.recipe.result_display_name)} ×${opt.recipe.result_quantity}</b>
        <span class="hint">${opt.ingredients.map(i => `${esc(i.emoji ?? '📦')} ${i.quantity_required}× ${esc(i.display_name)}`).join(' · ')}${opt.effectiveLaburoCost > 0 ? ` · 💪 ${opt.effectiveLaburoCost}` : ''}</span>
      </span>
      <button type="button" class="btn-secondary" data-craft-recipe-id="${opt.recipe.id}" data-craft-item-name="${escapeAttr(opt.recipe.result_name)}">Craftear</button>
    </div>`).join('');
}

export function wireCraftButtons(container: ParentNode, onCraft: (recipeId: number, itemName: string) => void): void {
  container.querySelectorAll<HTMLButtonElement>('[data-craft-recipe-id]').forEach(btn => {
    btn.addEventListener('click', () => onCraft(Number(btn.dataset.craftRecipeId), btn.dataset.craftItemName!));
  });
}
