---
name: btr-new-brand
description: 在 btr-orch 项目下创建新品牌 EPC 数据清洗项目。覆盖品牌信息收集、运维前置操作提示、代码目录生成（Python脚本/SQL文件/Shell脚本）、数据库表初始化、ES索引创建、平台配置注册全流程。当用户说"新建品牌"、"创建 XXX 品牌清洗项目"、"新增品牌项目"时使用。
disable-model-invocation: false
---

# BTR 新品牌清洗项目创建

在 `D:\Repository\btr-orch\brand\` 下为新品牌建立完整的 EPC 数据清洗项目。

## 模板变量说明

所有模板文件位于本 skill 的 `templates/` 目录，使用以下占位符：

| 变量 | 含义 | 示例 |
|------|------|------|
| `{{BRAND_EN}}` | 品牌项目标识（目录名/数据库名/Python变量名） | `honda_global`, `bmw` |
| `{{BRAND_CN}}` | 品牌中文显示名 | `本田`, `宝马` |
| `{{MANUFACTURER}}` | 平台 manufacturer 标识（用于 DB 中 manufacturer 字段、主名映射表名、ES 索引名等） | `honda`, `bmw` |
| `{{BRAND_ID}}` | vinanalysis.qp_brand 中的 BrandID | `1085` |
| `{{EPC_SERIES_ORDER}}` | epc_vehicle_series 排序值（避免与已有品牌冲突） | `90` |
| `{{ONLINE_DB_PASSWORD}}` | 线上 btr_analyser_config 加密密码（Phase 5 由运维提供，用于线上注册） | `EgKjpf...` |
| `{{ONLINE_DB_PUBLIC_KEY}}` | 线上 btr_analyser_config 公钥（Phase 5 由运维提供，用于线上注册） | `MFwwDQ...` |

> **注意**：`{{BRAND_EN}}` 与 `{{MANUFACTURER}}` 通常相同，但如果项目目录名与平台 manufacturer 标识不一致时（如目录 `honda_global` 对应 manufacturer `honda`），需分别填写。

---

## 执行流程

### Phase 0：信息收集（逐项向用户确认）

必须先收集以下信息，**每个问题单独询问，等用户回答后再继续**：

1. **`{{BRAND_EN}}`**：品牌项目标识（目录名/数据库名）。规则：纯小写字母+下划线，与数据目录名保持一致（例：`honda_global`、`toyota`）。
   - 确认后立即推导数据目录路径（见"数据目录推导"）。
2. **`{{BRAND_CN}}`**：品牌中文显示名（用于 epc_vehicle_series.value、btr_brand_config 等）。
3. **`{{MANUFACTURER}}`**：平台 manufacturer 标识。用于 `btr_analyser_config.manufacturer`、`qp_brand.manufacturer`、主名映射相关表名、ES 索引名等。大多数情况下与 `{{BRAND_EN}}` 相同，若不同请用户说明（如目录 `honda_global` 对应 manufacturer `honda`）。
4. **`{{BRAND_ID}}`**：在 vinanalysis.qp_brand 中的 BrandID。
   - 可直接查询：`SELECT BrandID, manufacturer, BrandName FROM vinanalysis.qp_brand WHERE BrandName LIKE '%{关键词}%' LIMIT 10`
   - 查到后向用户确认再继续。
5. **`{{EPC_SERIES_ORDER}}`**：epc_vehicle_series 中该品牌的排序值。
   - 先查当前最大值：`SELECT MAX(\`order\`) FROM common_evo.epc_vehicle_series WHERE title = '品牌'`
   - 推荐：已有最大值 +1，向用户确认。
6. **数据目录推导与 CSV 字段结构确认**

   **数据目录推导逻辑**（来自 `brand.py.tmpl` 的 `get_source_file_path` 方法）：

   a. 读取 `config_dir/{hostname}_config.json` 中的 `data_basic_path` 字段。
      - 若文件不存在或字段缺失，使用默认值 `/datashare/`（线上环境）。
      - 本地开发机示例：`D:\newData\data`。

   b. 品牌数据根目录：`{data_basic_path}/{BRAND_EN}/`

   c. 列出该目录下所有**纯数字命名**的子目录，取**最大值**作为版本号（对应 `get_largest_date_dir()`）。
      - 示例：`20260526`、`20260601` → 取 `20260601`

   d. 最终 CSV 文件路径：`{data_basic_path}/{BRAND_EN}/{max_version}/data/`

   **验证步骤**：列出该路径下的文件，确认 4 个 CSV 文件存在：
   - `raw_ve_data.csv`、`raw_group_data.csv`、`raw_parts_data.csv`、`raw_hotspot_data.csv`

   若目录不存在或文件缺失，**暂停并告知用户**，等待用户确认数据已就绪。

   **CSV 字段结构确认**：读取上述 4 个文件的表头（前 3 行），确认是否与标准结构一致：
   - 标准 `raw_ve_data.csv` 字段：`vehicle_model, features, brand, catalog`
   - 标准 `raw_group_data.csv` 字段：`channel, catalog, group_level, group_path, parent_group_path, group_no, group_order, group_name, group_desc, group_image_uri, group_image_id, group_features`
   - 标准 `raw_parts_data.csv` 字段：`channel, catalog, group_path, parts_order, parts_position, parts_code, parts_quantity, parts_name, parts_remark, parts_features`
   - 标准 `raw_hotspot_data.csv` 字段：`channel, catalog, group_path, parts_position, top_left_x, top_left_y, bottom_right_x, bottom_right_y`
   - 若字段不一致，需调整 `brand.py.tmpl` 中的 `*_csv_field_names` 变量。

---

### Phase 1：运维前置操作（需用户联系运维完成，AI 暂停等待）

**在开始创建文件前，告知用户需要先完成以下运维操作（数据库创建 + 线上主名映射表/视图创建）**

**内容来自 `other.sql.tmpl` 中内容分隔符 `-- ========== 以下由运维手动执行` 之后到 `-- ==========` 之间的内容段落**

```
伟成，麻烦在 vindb【线上】和【线下】库新增一个库：
{{BRAND_EN}}_evo
用来存放{{BRAND_CN}} EPC 数据。

【线下库】
- 授权给 evt 这个账户权限
- 新增到 Jenkins 授权：http://192.168.0.199:60000/jenkins/job/grant/

【线上库】
- 创建 {{BRAND_EN}}_evo 用户，授权 DDL、DML 权限
- 新增到 vinops 查询列表

【视图】
- 线上 vindb 的 parts_mapping 库中创建该表
...
- 新建的库麻烦再创建一下视图
...
```
- 【视图】部分的 ... 内容请阅读 `other.sql.tmpl` 中该内容段落，补全 SQL 内容后输出。
- 将 `{{BRAND_EN}}`、`{{BRAND_CN}}`、`{{MANUFACTURER}}` 替换为 Phase 0 收集到的实际值后输出

> **提示用户**：以上两项操作（数据库创建 + 线上主名映射表/视图创建）均完成后告知你，再继续执行 Phase 2。

---

### Phase 2：创建代码文件

数据库就绪后，从 `templates/` 读取并按照变量替换规则生成以下文件：

```
D:\Repository\btr-orch\brand\{{BRAND_EN}}\
├── {{BRAND_EN}}.py          ← templates/brand.py.tmpl
├── readme.md                ← templates/readme.md.tmpl
├── requirements.txt         ← templates/requirements.txt（不含变量，直接复制）
├── check.sh                 ← templates/check.sh.tmpl
├── process.sh               ← templates/process.sh.tmpl
├── mapping.sh               ← templates/mapping.sh.tmpl
└── sql\
    ├── {{BRAND_EN}}.sql         ← templates/sql/brand.sql.tmpl
    ├── init_tables.sql          ← templates/sql/init_tables.sql.tmpl
    ├── v2_dc_parts_{{BRAND_EN}}.sql ← templates/sql/v2_dc_parts.sql.tmpl
    └── other.sql                ← templates/sql/other.sql.tmpl
```

**替换规则**（全文替换，区分大小写）：

| 模板变量 | 替换为 |
|----------|--------|
| `{{BRAND_EN}}` | 实际品牌项目标识 |
| `{{BRAND_CN}}` | 实际品牌中文名 |
| `{{MANUFACTURER}}` | 实际平台 manufacturer 标识 |
| `{{BRAND_ID}}` | 实际 BrandID（数字） |
| `{{EPC_SERIES_ORDER}}` | 实际 order 值（数字） |

> **注意**：模板文件要先用 Read 工具读取，再替换变量后用 Write 工具写入目标路径。不要直接复制文件。

---

### Phase 3：数据库表初始化

#### 3.1 MySQL 建表

读取生成的 `sql/init_tables.sql` 内容，通过 DBHub MCP 执行：

1. 先切换到 `{{BRAND_EN}}_evo` 库，创建 **epc_*** 表（从 template_evo LIKE）
2. 在 `{{BRAND_EN}}_evo` 库创建 **raw_*** 表（DDL 内联定义）
3. 在 `{{BRAND_EN}}_evo` 库创建 **dc_parts_*** 表（DDL 内联定义）

执行方式：

```python
# 使用 DBHub execute_sql，注意 SQL 需拆分为单条执行（DBHub 不支持多语句批量）
```

执行完成后查询确认：

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = '{{BRAND_EN}}_evo'
ORDER BY table_name;
```

> **注意**：
> - 如果执行 SQL 期间遇到用户无权限访问 template_evo，**暂停并告知用户**，等待用户确认权限后再重新执行刚刚由于无权限而失败的命令，执行成功后继续后续步骤，否则仍然暂停并告知用户。
> - 如果执行 SQL 期间遇到执行失败，**暂停并告知用户**，等待用户确认后再重新执行刚刚执行失败的命令，执行成功后继续后续步骤，否则仍然暂停并告知用户；执行 SQL 失败时不要尝试去执行其他 SQL 操作，意图修复或绕过执行失败。

#### 3.2 ES 索引初始化

MySQL 建表完成后，检查并创建 ES 索引。

**索引名**（使用 `{{MANUFACTURER}}`）：
- `dp_parts_info_{{MANUFACTURER}}`
- `dp_rule_parts_name_{{MANUFACTURER}}`

**ES 地址**：`http://192.168.0.150:9200`

**检查索引是否存在**（逐个检查）：

```
curl.exe -s -o NUL -w "%{http_code}" "http://192.168.0.150:9200/{索引名}"
```

- 返回 `200` → 索引已存在，告知用户"索引 {索引名} 已存在，跳过创建"
- 返回 `404` → 索引不存在，需要创建
- 其他状态码或超时 → **暂停并告知用户**，输出完整 curl 命令供用户手动执行，等待用户确认是否创建索引后继续下面的操作，否则跳过本步骤。

**若两个索引都已存在**，告知用户并跳过本步骤。

**创建缺失的索引**：

1. 读取对应 mapping 模板文件，将 `{{MANUFACTURER}}` 替换为实际值后写入临时文件：
   - `dp_parts_info` → `templates/es/dp_parts_info_mapping.json`
   - `dp_rule_parts_name` → `templates/es/dp_rule_parts_name_mapping.json`
2. 执行创建命令：

```
curl.exe -s -H "Content-Type: application/json" -X PUT "http://192.168.0.150:9200/{索引名}" -d @{临时文件路径}
```

3. 检查返回结果，若创建失败 → **暂停并告知用户完整错误信息**，等待用户确认后重试

> **注意**：ES 索引操作与 SQL 执行一样，遇到任何失败都**暂停、告知用户、不绕过、不尝试修复**。

---

### Phase 4：平台注册（自动部分）

读取生成的 `sql/other.sql`，**只执行"由脚本自动执行"段落**（文件分隔符 `-- ========== 以下由运维手动执行` 之前的内容）：

按顺序执行以下操作：

1. `common_evo.btr_analyser_config`：注册线下分析器。
2. `common_evo.btr_analyser_chain`：注册线下分析链
3. **`vinanalysis.qp_brand`：更新 manufacturer 字段（需先确认，见下）**
4. `common_evo.btr_manufacturer_config`：注册线下车厂配置
5. `common_evo.btr_brand_config`（×2）：注册线下品牌展示配置
6. `common_evo.epc_vehicle_series`：注册线下品牌系列

**qp_brand 更新前的确认步骤：**

执行更新前，先查询该品牌当前的 manufacturer 值：

```sql
SELECT BrandID, BrandName, manufacturer
FROM vinanalysis.qp_brand
WHERE BrandID = {{BRAND_ID}};
```

将查询结果告知用户，询问：
> "当前该品牌的 manufacturer 为 `{当前值}`，是否需要修改为 `{{MANUFACTURER}}`？"

- 用户确认需要修改 → 执行 UPDATE
- 用户确认无需修改（或已正确）→ 跳过该 UPDATE

> **注意**：如果执行 SQL 期间遇到执行失败，**暂停并告知用户**，等待用户确认后再重新执行刚刚执行失败的命令，执行成功后继续后续步骤，否则仍然暂停并告知用户；执行 SQL 失败时不要尝试去执行其他 SQL 操作，意图修复或绕过执行失败。
---

### Phase 5：运维后续操作提示

完成以上步骤后，按以下顺序收集信息并输出内容提示用户交给运维完成：

---

**第一步：收集线上 db_password / db_publickey**

向用户说明：线上环境需要为 `{{BRAND_EN}}_evo` 数据库用户注册分析器配置，请向运维索取以下两个值：
- `db_password`：线上数据库用户 `{{BRAND_EN}}_evo` 的加密密码密文
- `db_publickey`：对应的公钥字符串

等用户提供后，分别赋给 `{{ONLINE_DB_PASSWORD}}` 和 `{{ONLINE_DB_PUBLIC_KEY}}`。

---

**第二步：输出线上平台注册 SQL（交运维在线上 common_evo 库执行）**

读取生成的 `sql/other.sql`，**"由脚本自动执行"段落**（文件分隔符 `-- ========== 以下由运维手动执行` 之前的内容）：
1. common_evo.btr_analyser_config 表 insert 语句的对应字段进行以下更改操作，其余字段值不改动（占位符变量值要进行替换）。
   - 将 db_url 表字段的插入记录值置为 `jdbc:mysql://10.1.1.118:3306/{{BRAND_EN}}_evo?characterEncoding=UTF-8&useSSL=false&requireSSL=false`
   - 将 db_user 表字段的插入记录值置为 `{{BRAND_EN}}_evo` 
   - 将 db_password 表字段值置为 `{{ONLINE_DB_PASSWORD}}`
   - 将 db_publickey 表字段值置为 `{{ONLINE_DB_PUBLIC_KEY}}`
2. 其他的 SQL 内容不改变。
3. 输出内容给用户。 

---

**第三步：其余运维操作（完整 SQL 在 `sql/other.sql` 运维段落中，输内容让我可直接发给运维）**

1. **主名映射表（内网）**：
   - `partsmapping.dc_parts_mapping_{{MANUFACTURER}}`（主名映射平台内网表）
   - `partsmapping.{{MANUFACTURER}}_parts_mapping_v2`（内网 mysql 表）
2. **线下主名映射表**：`parts_mapping.{{MANUFACTURER}}_parts_mapping_v2`（线下 mysql 表）
3. **ES 同步配置**：在 `partsmapping.bp_synchronous_config` 插入记录（`status=0`，未开启）
4. **DC 同步配置**：在 `carvin.dc_sync_config` 插入记录
5. **主名映射平台配置**：在 `partsmapping.dc_carfactory_config` 插入记录
6. **图片/热点表**：创建 `dc_parts_image_{{MANUFACTURER}}` 和 `dc_parts_image_hotspot_{{MANUFACTURER}}`（内网）
7. **同步工单**：执行 `sync_to_online_new2.sh` 将 epc 表同步到线上

---

## 进度跟踪清单

开始执行时使用以下 TodoWrite 任务跟踪进度：

```
- [ ] Phase 0：收集品牌信息（BRAND_EN / BRAND_CN / MANUFACTURER / BRAND_ID / EPC_SERIES_ORDER / CSV结构）
- [ ] Phase 1：提示运维创建 {{BRAND_EN}}_evo 数据库 + 在线上创建主名映射表和视图，等待用户确认完成
- [ ] Phase 2：生成 brand/ 目录及全部代码文件（5个变量替换）
- [ ] Phase 3.1：执行 init_tables.sql 初始化 MySQL 表
- [ ] Phase 3.2：检查并创建 ES 索引（dp_parts_info_{{MANUFACTURER}} / dp_rule_parts_name_{{MANUFACTURER}}）
- [ ] Phase 4：查询 qp_brand manufacturer → 用户确认 → 执行 other.sql 自动注册段落
- [ ] Phase 5：收集线上 ONLINE_DB_PASSWORD / ONLINE_DB_PUBLIC_KEY → 输出线上注册 SQL（btr_analyser_config / chain / manufacturer_config / brand_config）→ 输出其余运维操作清单
```

---

## 注意事项

- **不要**参考现有品牌目录（hongqi/xiaomi等）来拷贝文件，始终使用 `templates/` 中的模板。
- `{{ONLINE_DB_PASSWORD}}` / `{{ONLINE_DB_PUBLIC_KEY}}` 用于线上 `btr_analyser_config` 注册，在 Phase 5 向用户收集（运维创建线上 `{{BRAND_EN}}_evo` 用户后提供）。
- DBHub 执行 SQL 时，每次只执行一条语句，不支持多语句批量执行。
- `init_tables.sql` 中 `raw_*` 表的 DDL 在无库名前缀时，需先确认当前连接库为 `{{BRAND_EN}}_evo`。
- 如果 CSV 字段与标准结构不一致，需在生成 `{{BRAND_EN}}.py` 时调整对应的 `*_csv_field_names` 列表。
- ES 索引创建使用 `curl.exe`（非 `curl`），避免 Windows PowerShell 的 `Invoke-WebRequest` 别名冲突。

## 模板文件位置

所有模板位于本 skill 所在目录的 `templates/` 子目录：

```
templates/
├── brand.py.tmpl
├── check.sh.tmpl
├── process.sh.tmpl
├── mapping.sh.tmpl
├── requirements.txt
├── readme.md.tmpl
├── es/
│   ├── dp_parts_info_mapping.json
│   └── dp_rule_parts_name_mapping.json
└── sql/
    ├── brand.sql.tmpl
    ├── init_tables.sql.tmpl
    ├── v2_dc_parts.sql.tmpl
    └── other.sql.tmpl
```

读取模板时使用绝对路径：`C:\Users\Baturu\.agents\skills\btr-new-brand\templates\`
