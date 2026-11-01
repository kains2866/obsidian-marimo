import marimo

__generated_with = "0.25.2"
app = marimo.App(width="medium")


@app.cell
def _():
    import math

    import marimo as mo

    return math, mo


@app.cell
def _(mo):
    mo.md(
        """
        # marimo 能力演示

        这一个文件把 marimo 最常用的能力集中跑一遍，用来在 Obsidian 里确认原生前端覆盖到哪一步。

        - **反应式数据流**：改上游变量，下游自动重算，单元格的排列顺序不决定依赖
        - **交互控件**：`mo.ui.*` 的 16 种控件全部映射成 Obsidian 原生控件
        - **Markdown 与公式**：静态 `mo.md` 交给 Obsidian 自己的排版引擎
        - **表格与 SQL**：`mo.ui.table` 与 `mo.sql`（duckdb）
        - **输出通道**：标准输出、结构化返回、条件停止

        > 快捷键：`⌘⏎` 运行当前单元格，`⇧⏎` 运行并跳到下一格。
        """
    )
    return


@app.cell
def _(mo):
    mo.md(
        """
        ## 1 反应式数据流

        下面三格互不调用 `run()`：`radius` 一变，`area` 自动重算，再往下那格的文字也跟着变。
        依赖关系由 marimo 从变量的定义与引用里推出来，不是靠执行顺序。
        """
    )
    return


@app.cell
def _():
    radius = 6
    return (radius,)


@app.cell
def _(math, radius):
    area = round(math.pi * radius**2, 2)
    return (area,)


@app.cell
def _(area, mo, radius):
    mo.md(f"半径 **{radius}** 的圆面积是 **{area}**。把上一格的 `radius` 改成别的数字再运行，这里会自己更新。")
    return


@app.cell
def _(mo):
    mo.md(
        """
        ## 2 交互控件

        每个控件都是独立的单元格：值回写到内核后，依赖它的单元格重新执行一轮。
        下面这组覆盖 `mo.ui` 的全部可用类型。
        """
    )
    return


@app.cell
def _(mo):
    columns = mo.ui.slider(1, 6, value=3, step=1, label="每行列数")
    columns
    return (columns,)


@app.cell
def _(columns, mo):
    mo.md(f"当前 **{columns.value}** 列。滑块松手才提交，每次提交是一个完整的反应式周期。")
    return


@app.cell
def _(mo):
    window = mo.ui.range_slider(0, 100, value=[20, 80], step=5, label="区间")
    window
    return (window,)


@app.cell
def _(mo, window):
    low, high = window.value
    mo.md(f"区间 **{low} – {high}**，宽度 **{high - low}**，中点 **{(low + high) / 2:.0f}**。")
    return


@app.cell
def _(mo):
    quantity = mo.ui.number(0, 200, value=42, step=1, label="数量")
    quantity
    return (quantity,)


@app.cell
def _(mo):
    name = mo.ui.text(value="marimo", label="名字", placeholder="输入一个名字")
    name
    return (name,)


@app.cell
def _(mo):
    note = mo.ui.text_area(value="在这里随便写点什么", label="备注")
    note
    return (note,)


@app.cell
def _(mo):
    agree = mo.ui.checkbox(label="我确认这是一次演示")
    agree
    return (agree,)


@app.cell
def _(mo):
    live = mo.ui.switch(label="实时联动", value=True)
    live
    return (live,)


@app.cell
def _(mo):
    color = mo.ui.radio(["红", "绿", "蓝"], value="绿", label="颜色")
    color
    return (color,)


@app.cell
def _(mo):
    city = mo.ui.dropdown(["北京", "上海", "深圳", "成都"], value="上海", label="城市")
    city
    return (city,)


@app.cell
def _(mo):
    tags = mo.ui.multiselect(["数据", "图表", "交互", "公式"], value=["数据"], label="标签")
    tags
    return (tags,)


@app.cell
def _(mo):
    day = mo.ui.date(value="2026-11-01", label="日期")
    day
    return (day,)


@app.cell
def _(mo):
    from datetime import datetime

    moment = mo.ui.datetime(value=datetime(2026, 11, 1, 9, 30), label="时刻")
    moment
    return (moment,)


@app.cell
def _(agree, city, color, day, live, mo, moment, name, note, quantity, tags, window):
    mo.md(
        f"""
        | 控件 | 当前值 |
        | --- | --- |
        | 数量 | {quantity.value} |
        | 名字 | {name.value} |
        | 备注 | {note.value} |
        | 勾选 | {agree.value} |
        | 开关 | {live.value} |
        | 颜色 | {color.value} |
        | 城市 | {city.value} |
        | 标签 | {tags.value} |
        | 日期 | {day.value} |
        | 时刻 | {moment.value} |
        | 区间 | {window.value} |
        """
    )
    return


@app.cell
def _(mo):
    mo.md(
        """
        ## 3 状态与表单

        `mo.state` 把可变状态放在内核里；`mo.ui.form` 则把一组控件攒起来，按下提交才一次性提交。
        """
    )
    return


@app.cell
def _(mo):
    get_clicks, set_clicks = mo.state(0)
    bump = mo.ui.button(label="点一下", on_click=lambda _: set_clicks(get_clicks() + 1))
    bump
    return bump, get_clicks


@app.cell
def _(get_clicks, mo):
    mo.md(f"已经点了 **{get_clicks()}** 次。按钮的值在内核里，视图只负责把点击送过去。")
    return


@app.cell
def _(mo):
    signup = mo.ui.form(
        mo.ui.text(label="你的名字", placeholder="留空也能提交"),
        label="报名表（提交才生效）",
        submit_button_label="提交",
    )
    signup
    return (signup,)


@app.cell
def _(mo, signup):
    mo.stop(
        signup.value is None,
        mo.callout(mo.md("还没提交：表单的值在按下提交之前一直是 `None`。"), kind="neutral"),
    )
    mo.md(f"已提交：**{signup.value}**")
    return


@app.cell
def _(mo):
    mo.md(
        """
        ## 4 组合与嵌套

        `mo.ui.tabs` 的每个面板都是完整的 marimo 对象，里面还能再放控件和 markdown。
        """
    )
    return


@app.cell
def _(mo):
    views = mo.ui.tabs(
        {
            "概览": mo.md("这一页是 **概览**。标签页切换会把选中下标回写到内核。"),
            "细节": mo.md("这一页是 **细节**：面板里同样可以是任意 marimo 对象，而不只是文字。"),
        }
    )
    views
    return (views,)


@app.cell
def _(mo):
    mo.md(
        """
        ## 5 表格与 SQL

        `mo.ui.table` 接收结构化数据；`mo.sql` 用内置的 duckdb 直接查当前内核里的 DataFrame，
        不需要额外连接，也不需要写 `import duckdb`。
        """
    )
    return


@app.cell
def _(mo):
    table = mo.ui.table(
        [
            {"城市": "北京", "销量": 128, "同比": "+12%"},
            {"城市": "上海", "销量": 203, "同比": "+8%"},
            {"城市": "深圳", "销量": 96, "同比": "-3%"},
            {"城市": "成都", "销量": 74, "同比": "+21%"},
        ],
        label="各城市销量",
    )
    table
    return (table,)


@app.cell
def _():
    import polars as pl

    sales = pl.DataFrame(
        {
            "region": ["华东", "华东", "华南", "华北", "华南", "华北"],
            "amount": [120, 80, 45, 200, 60, 48],
        }
    )
    return (sales,)


@app.cell
def _(mo, sales):
    ranking = mo.sql(
        "SELECT region, SUM(amount) AS 销售额 FROM sales GROUP BY region ORDER BY 销售额 DESC"
    )
    return (ranking,)


@app.cell
def _(mo):
    mo.md(
        """
        ## 6 输出通道

        `print()` 走控制台通道，最后一个表达式是主输出，二者分别显示。
        """
    )
    return


@app.cell
def _(quantity):
    print("这一行来自 print()，走控制台通道")
    print("数量 × 2 =", quantity.value * 2)
    return


@app.cell
def _(name, tags):
    {"名字": name.value, "名字长度": len(name.value), "已选标签": tags.value}
    return


@app.cell
def _(columns, mo):
    mo.stop(
        columns.value < 2,
        mo.callout(mo.md("列数小于 2，本格后面的代码不会执行。"), kind="warn"),
    )
    mo.md(f"列数 **{columns.value}**，条件满足，这一行才会出现。")
    return


@app.cell
def _(mo):
    mo.md(
        r"""
        ## 7 排版与公式

        静态 `mo.md` 由 Obsidian 的 Markdown 引擎渲染，所以 Obsidian 自己的语法也能用：

        行内公式 $e^{i\pi} + 1 = 0$，块级公式：

        $$
        \int_0^1 x^2\,\mathrm{d}x = \frac{1}{3}
        $$

        | 能力 | 谁来渲染 |
        | --- | --- |
        | 标题、列表、表格 | Obsidian |
        | 行内与块级公式 | Obsidian（MathJax） |
        | 内链、标签、提示块 | Obsidian |
        | 交互控件的值 | 内核 |

        - [x] 静态 markdown 单元格默认折叠 Python 包装
        - [ ] 点单元格右下角的 `<>` 可以展开源码

        > 引用块也能用，例如这条：`mo.md` 只是把字符串交给排版引擎，不执行里面的内容。

        指向另一篇笔记的内链：[[marimo-native-demo]]
        """
    )
    return


@app.cell
def _(mo):
    mo.md(
        """
        ## 8 收尾

        到这里，marimo 的常用能力都在这个文件里跑过一遍了：

        - 反应式依赖、16 种 `mo.ui` 控件、`mo.state`、`mo.ui.form`、`mo.ui.tabs`
        - `mo.ui.table`、`mo.sql`（duckdb）、控制台输出、结构化返回、`mo.stop` 守卫
        - 静态 markdown 的排版、公式、任务列表、内链

        想试反应式，就改第 3 节的 `radius`；想试控件回写，就拖一下滑块或点一下按钮。
        """
    )
    return


if __name__ == "__main__":
    app.run()
