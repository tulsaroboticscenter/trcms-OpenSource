<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Field;

/**
 * Assets = inventory items that are tracked as assets (tagged or non-tagged),
 * with asset-specific fields. Reuses the Inventory joins/scope, constrains the
 * base to asset-typed items, and adds acquisition/donation fields.
 */
final class AssetsDataset extends InventoryDataset
{
    public function key(): string { return 'assets'; }
    public function label(): string { return 'Assets'; }

    public function baseWhere(): array
    {
        return ["i.item_type IN ('asset_tagged','asset_nontagged')", []];
    }

    public function fields(): array
    {
        return array_merge(parent::fields(), [
            'purchase_date' => new Field('purchase_date', 'Acquired', 'i.purchase_date', 'date', 'internal'),
            'is_donated'    => new Field('is_donated', 'Donated', 'i.is_donated', 'bool', 'internal'),
            'donation_date' => new Field('donation_date', 'Donation date', 'i.donation_date', 'date', 'internal'),
        ]);
    }
}
