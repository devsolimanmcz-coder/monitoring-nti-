const ICMP_HOSTS = `
  SELECT 'LINK MCOIP-08916-ICMP' AS host, 'network' AS section_id, 1 AS section_order, 1 AS host_order, 5 AS loss_warning
  UNION ALL SELECT 'LINK MCOIP-08917-ICMP', 'network', 1, 2, 5
  UNION ALL SELECT 'INTERFACE-GIGA-CISCO', 'network', 1, 3, 5
  UNION ALL SELECT 'LINK-BASE-FICCO-ICMP', 'network', 1, 4, 5
  UNION ALL SELECT 'LINK-PORTO-ICMP', 'network', 1, 5, 5
  UNION ALL SELECT 'LINK-MACEIO-PEP-ICMP', 'network', 1, 6, 5
  UNION ALL SELECT 'AERO-MCZ-PF-AL', 'network', 1, 7, 5
  UNION ALL SELECT 'LINK-ARAPIRACA-PEP-ICMP', 'network', 1, 8, 5
  UNION ALL SELECT 'DNS-SR-AL-ICMP', 'network', 1, 9, 5
  UNION ALL SELECT 'DNSBSB01-ICMP', 'network', 1, 10, 5
  UNION ALL SELECT 'DNSBSB02-ICMP', 'network', 1, 11, 5
  UNION ALL SELECT 'PROXY-BSB-ICMP', 'network', 1, 12, 5
  UNION ALL SELECT 'SINPA-ICMP', 'applications', 2, 1, 1
  UNION ALL SELECT 'SIGEPOL-ICMP', 'applications', 2, 2, 1
  UNION ALL SELECT 'EPOL-ICMP', 'applications', 2, 3, 1
  UNION ALL SELECT 'INTRANET-ICMP', 'applications', 2, 4, 1
  UNION ALL SELECT 'CITSMART', 'applications', 2, 5, 1
  UNION ALL SELECT 'SEI-ICMP', 'applications', 2, 6, 1
  UNION ALL SELECT 'CATALOGO-DE-SISTEMAS', 'applications', 2, 7, 1
  UNION ALL SELECT 'SISTEMA-REF', 'applications', 2, 8, 1
`

export const ICMP_QUERY = `
  WITH selected_icmp_hosts AS (${ICMP_HOSTS}),
  loss_avg AS (
    SELECT hist.itemid, AVG(hist.value) AS icmp_loss
    FROM history hist
    INNER JOIN items it ON it.itemid = hist.itemid
    INNER JOIN hosts loss_host ON loss_host.hostid = it.hostid
    INNER JOIN selected_icmp_hosts selected ON selected.host = loss_host.host
    WHERE it.key_ = 'icmppingloss'
      AND it.status = 0
      AND hist.clock >= UNIX_TIMESTAMP() - 600
    GROUP BY hist.itemid
  )
  SELECT
    REPLACE(h.host, '-ICMP', '') AS host_name,
    selected.section_id,
    ROUND(hr.value * 1000, 2) AS icmp_ms,
    p.value AS ping_value,
    ROUND(loss_avg.icmp_loss, 2) AS icmp_loss,
    CASE
      WHEN loss_avg.icmp_loss IS NULL THEN '#94a3b8'
      WHEN loss_avg.icmp_loss = 0 THEN '#34d399'
      WHEN loss_avg.icmp_loss < selected.loss_warning THEN '#facc15'
      ELSE '#f87171'
    END AS icmp_loss_color,
    CASE
      WHEN hr.clock IS NULL OR UNIX_TIMESTAMP() - hr.clock > 180 THEN '#94a3b8'
      WHEN hr.value * 1000 <= 50 THEN '#34d399'
      WHEN hr.value * 1000 <= 100 THEN '#facc15'
      ELSE '#f87171'
    END AS latency_color,
    CASE
      WHEN hr.clock IS NULL OR UNIX_TIMESTAMP() - hr.clock > 180 THEN 'SEM DADOS'
      WHEN p.clock IS NULL OR UNIX_TIMESTAMP() - p.clock > 180 THEN 'PING SEM DADOS'
      WHEN p.value = 0 THEN 'OFFLINE'
      WHEN hr.value * 1000 > 100 THEN 'ALERTA'
      ELSE 'ONLINE'
    END AS status_text,
    CASE
      WHEN hr.clock IS NULL OR UNIX_TIMESTAMP() - hr.clock > 180 THEN '#94a3b8'
      WHEN p.clock IS NULL OR UNIX_TIMESTAMP() - p.clock > 180 THEN '#facc15'
      WHEN p.value = 0 THEN '#f87171'
      WHEN hr.value * 1000 > 100 THEN '#facc15'
      ELSE '#34d399'
    END AS status_color
  FROM selected_icmp_hosts selected
  INNER JOIN hosts h ON h.host = selected.host
  LEFT JOIN items i
    ON i.hostid = h.hostid
    AND i.key_ = 'icmppingsec'
    AND i.status = 0
  LEFT JOIN history hr
    ON hr.itemid = i.itemid
    AND hr.clock = (
      SELECT MAX(h2.clock)
      FROM history h2
      WHERE h2.itemid = i.itemid
    )
    AND hr.ns = (
      SELECT MAX(h3.ns)
      FROM history h3
      WHERE h3.itemid = i.itemid
        AND h3.clock = hr.clock
    )
  LEFT JOIN items pi
    ON pi.hostid = h.hostid
    AND pi.key_ = 'icmpping'
    AND pi.status = 0
  LEFT JOIN history_uint p
    ON p.itemid = pi.itemid
    AND p.clock = (
      SELECT MAX(p2.clock)
      FROM history_uint p2
      WHERE p2.itemid = pi.itemid
    )
    AND p.ns = (
      SELECT MAX(p3.ns)
      FROM history_uint p3
      WHERE p3.itemid = pi.itemid
        AND p3.clock = p.clock
    )
  LEFT JOIN items li
    ON li.hostid = h.hostid
    AND li.key_ = 'icmppingloss'
    AND li.status = 0
  LEFT JOIN loss_avg ON loss_avg.itemid = li.itemid
  ORDER BY selected.section_order, selected.host_order
`

const SELECTED_HOSTS = `
  SELECT hostid, host AS host_name
  FROM hosts
  WHERE host IN (
    'SAL0017',
    'SAL0013',
    'SAL0027-PE-R7525-SNMP',
    'SAL0026-PE-R7525-SNMP',
    'SAL0016'
  )
`

const SELECTED_ITEMS = `
  SELECT
    h.hostid,
    h.host_name,
    i.itemid,
    i.key_,
    i.value_type
  FROM selected_hosts h
  INNER JOIN items i ON i.hostid = h.hostid
  WHERE i.status = 0
    AND (
      i.key_ IN (
        'system.cpu.util',
        'vm.memory.util',
        'vm.memory.size[used]',
        'vm.memory.size[total]'
      )
      OR i.key_ REGEXP '^vfs[.]fs[.]size\\[[A-Z]:,(used|total|pused)\\]$'
    )
`

const ITEM_VALUES = `
  SELECT
    i.hostid,
    i.host_name,
    i.key_,
    CASE i.value_type
      WHEN 0 THEN (
        SELECT hist.value
        FROM history hist
        WHERE hist.itemid = i.itemid
        ORDER BY hist.clock DESC, hist.ns DESC
        LIMIT 1
      )
      WHEN 3 THEN (
        SELECT hist_uint.value
        FROM history_uint hist_uint
        WHERE hist_uint.itemid = i.itemid
        ORDER BY hist_uint.clock DESC, hist_uint.ns DESC
        LIMIT 1
      )
    END AS item_value
  FROM selected_items i
  WHERE i.value_type IN (0, 3)
`

export const SERVER_METRICS_QUERY = `
  WITH
    selected_hosts AS (${SELECTED_HOSTS}),
    selected_items AS (${SELECTED_ITEMS}),
    item_values AS (${ITEM_VALUES})
  SELECT
    h.host_name,
    ROUND(MAX(CASE WHEN v.key_ = 'system.cpu.util' THEN v.item_value END), 1) AS cpu_pct,
    ROUND(MAX(CASE WHEN v.key_ = 'vm.memory.util' THEN v.item_value END), 1) AS ram_pct,
    ROUND(MAX(CASE WHEN v.key_ = 'vm.memory.size[used]' THEN v.item_value END) / 1073741824, 1) AS ram_used_gib,
    ROUND(MAX(CASE WHEN v.key_ = 'vm.memory.size[total]' THEN v.item_value END) / 1073741824, 1) AS ram_total_gib
  FROM selected_hosts h
  LEFT JOIN item_values v ON v.hostid = h.hostid
  GROUP BY h.hostid, h.host_name
  ORDER BY h.host_name
`

export const SERVER_DISKS_QUERY = `
  WITH
    selected_hosts AS (${SELECTED_HOSTS}),
    selected_items AS (${SELECTED_ITEMS}),
    item_values AS (${ITEM_VALUES}),
    disk_values AS (
      SELECT
        hostid,
        host_name,
        SUBSTRING_INDEX(SUBSTRING_INDEX(key_, '[', -1), ',', 1) AS drive,
        MAX(CASE WHEN key_ LIKE '%,used]' THEN item_value END) AS used_bytes,
        MAX(CASE WHEN key_ LIKE '%,total]' THEN item_value END) AS total_bytes,
        MAX(CASE WHEN key_ LIKE '%,pused]' THEN item_value END) AS used_pct
      FROM item_values
      WHERE key_ REGEXP '^vfs[.]fs[.]size\\[[A-Z]:,(used|total|pused)\\]$'
      GROUP BY
        hostid,
        host_name,
        SUBSTRING_INDEX(SUBSTRING_INDEX(key_, '[', -1), ',', 1)
    )
  SELECT
    host_name,
    drive,
    ROUND(used_pct, 1) AS used_pct,
    ROUND(used_bytes / 1073741824, 1) AS used_gib,
    ROUND(total_bytes / 1073741824, 1) AS total_gib
  FROM disk_values
  ORDER BY host_name, drive
`

export const CATALOG_QUERY = `
  SELECT
    h.hostid,
    h.host,
    i.itemid,
    i.name AS item_name,
    i.key_,
    i.value_type,
    i.units
  FROM hosts h
  INNER JOIN items i ON i.hostid = h.hostid
  WHERE h.status = 0
    AND i.status = 0
    AND i.value_type IN (0, 3)
    AND (? = 0 OR h.hostid = ?)
    AND (? = '' OR i.name LIKE ? OR i.key_ LIKE ?)
  ORDER BY h.host, i.name
  LIMIT 100 OFFSET ?
`

export const CATALOG_HOSTS_QUERY = `
  SELECT h.hostid, h.host
  FROM hosts h
  WHERE h.status = 0
    AND EXISTS (
      SELECT 1
      FROM items i
      WHERE i.hostid = h.hostid
        AND i.status = 0
        AND i.value_type IN (0, 3)
    )
  ORDER BY h.host
`

export const ITEM_TYPE_QUERY = `
  SELECT i.itemid, i.name AS item_name, i.value_type, i.units, h.host AS host_name
  FROM items i
  INNER JOIN hosts h ON h.hostid = i.hostid
  WHERE i.itemid = ?
    AND i.status = 0
    AND h.status = 0
    AND i.value_type IN (0, 3)
  LIMIT 1
`

export const ITEM_TYPE_BATCH_QUERY = `
  SELECT i.itemid, i.name AS item_name, i.value_type, i.units, h.host AS host_name
  FROM items i
  INNER JOIN hosts h ON h.hostid = i.hostid
  WHERE i.itemid IN (%s)
    AND i.status = 0
    AND h.status = 0
    AND i.value_type IN (0, 3)
`
