import React, { useCallback, useEffect, useRef } from "react";
import * as d3 from "d3";
import type { SystemState } from "ott-vis/types";
import {
	buildFullTree,
	filterTreeGroups,
	pruneTrees,
	type BoundingBox,
	type TreeNode,
	treeBoundingBox,
	calcGoodTreeRadius,
	superBoundingBox,
	offsetBBox,
	expandBBox,
} from "treeutils";
import "./topology-view.css";
import { useColorProvider } from "colors";
import { useD3Zoom } from "chartutils";

/**
 * The goal of this component is to show a more accurate topology view from the perspective of actual network connections.
 *
 * There will be 2 types of trees: Balancer Trees and Monolith Trees. The Balancer Trees will show the connections between Balancers and clients, while the Monolith Trees will show the connections between Monoliths and Rooms.
 *
 * These trees will be grouped by region, and the nodes will be colored by group. Balancer Trees will be on the left, and Monolith Trees will be on the right, with connections between Balancers and Monoliths, and regions being shown by boxing the trees that are in the same region.
 */

interface TopologyViewProps extends TopologyViewStyleProps {
	systemState: SystemState;
	width: number;
	height: number;
}

export interface TopologyViewStyleProps {
	baseNodeRadius: number;
	clientNodeRadius: number;
	subtreePadding: number;
}

interface Subtree {
	tree: d3.HierarchyNode<TreeNode>;
	bbox: BoundingBox;
	x: number;
	y: number;
}

interface PrebuiltRegion {
	name: string;
	balancerTrees: d3.HierarchyNode<TreeNode>[];
	monolithTrees: d3.HierarchyNode<TreeNode>[];
}

interface Region {
	name: string;
	balancerSubtrees: Subtree[];
	monolithSubtrees: Subtree[];
	bbox: BoundingBox;
}

const DEBUG_BOUNDING_BOXES = false;

export const TopologyView: React.FC<TopologyViewProps> = ({
	systemState,
	width,
	height,
	baseNodeRadius = 20,
	clientNodeRadius = 8,
	subtreePadding = 60,
}) => {
	const svgRef = useRef<SVGSVGElement | null>(null);
	const fullTree = d3.hierarchy(buildFullTree(systemState));
	const monolithTrees = pruneTrees(fullTree, "monolith", "room");
	const balancerTrees = filterTreeGroups(fullTree, ["balancer", "client"]);
	const colors = useColorProvider();

	const getRadius = useCallback(
		(group: string): number => {
			if (group === "client") {
				return clientNodeRadius;
			} else {
				return baseNodeRadius;
			}
		},
		[baseNodeRadius, clientNodeRadius]
	);

	useEffect(() => {
		if (!svgRef.current) {
			return;
		}

		const svg = d3.select(svgRef.current);

		const monolithRegions: Map<string, PrebuiltRegion> = new Map();
		for (const tree of monolithTrees) {
			const region = tree.data.region;
			if (!monolithRegions.has(region)) {
				monolithRegions.set(region, {
					name: region,
					balancerTrees: [],
					monolithTrees: [],
				});
			}
			monolithRegions.get(region)?.monolithTrees.push(tree);
		}
		for (const tree of balancerTrees) {
			const region = tree.data.region;
			if (!monolithRegions.has(region)) {
				monolithRegions.set(region, {
					name: region,
					balancerTrees: [],
					monolithTrees: [],
				});
			}
			monolithRegions.get(region)?.balancerTrees.push(tree);
		}

		const diagonal = d3
			.linkRadial<any, TreeNode>()
			.angle((d: any) => Math.atan2(d.y, d.x) + Math.PI / 2)
			.radius((d: any) => Math.sqrt(d.x * d.x + d.y * d.y));
		function renderTrees(trees: Subtree[], groupClass: string) {
			svg.select(groupClass)
				.selectAll(".tree")
				.data(trees)
				.join(
					create => {
						const group = create.append("g").attr("class", "tree");
						group.append("g").attr("class", "links");
						group.append("g").attr("class", "nodes");
						group.append("g").attr("class", "texts");
						return group;
					},
					update => update,
					exit => exit.remove()
				)
				.attr("transform", d => `translate(${d.x}, ${d.y})`)
				.each(function (subtree) {
					const tree = subtree.tree;
					const group = d3.select(this);
					const gLinks = group.select(".links");
					const gNodes = group.select(".nodes");
					gLinks
						.selectAll(".link")
						.data(tree.links(), (d: any) => d.source?.data?.id + d.target?.data?.id)
						.join("path")
						.attr("class", "link")
						.attr("data-nodeid-source", d => d.source.data.id)
						.attr("data-nodeid-target", d => d.target.data.id)
						.attr("d", diagonal)
						.attr("stroke-width", 1.5);

					gNodes
						.selectAll(".node")
						.data(tree.descendants(), (d: any) => d.data.id)
						.join("circle")
						.attr("class", "node")
						.attr("data-nodeid", d => d.data.id)
						.attr("cx", (d: any) => d.x)
						.attr("cy", (d: any) => d.y)
						.attr("r", d => getRadius(d.data.group))
						.attr("fill", d => colors.assign(d.data.group));
				});
		}

		function buildRegion(region: PrebuiltRegion): Region {
			const monolithSubtrees: Subtree[] = [];
			const balancerSubtrees: Subtree[] = [];

			let balancerYs = 0;
			for (const tree of region.balancerTrees) {
				const radius = calcGoodTreeRadius(tree, clientNodeRadius, 0);
				const layout = d3.tree<TreeNode>().size([-Math.PI, radius]);
				layout(tree);
				// precompute radial coordinates
				tree.each(node => {
					// @ts-expect-error d3 adds x and y to the node
					const [x, y] = d3.pointRadial(node.x, node.y);
					// @ts-expect-error d3 adds x and y to the node
					node.x = x;
					// @ts-expect-error d3 adds x and y to the node
					node.y = y;
				});
				const bbox = treeBoundingBox(tree);
				balancerSubtrees.push({
					tree,
					bbox,
					x: -100,
					y: balancerYs,
				});
				const [_left, top, _right, bottom] = bbox;
				const height = bottom - top;
				balancerYs += height + subtreePadding;
			}
			let monolithYs = 0;
			for (const tree of region.monolithTrees) {
				const radius = calcGoodTreeRadius(tree, baseNodeRadius);
				const layout = d3.tree<TreeNode>().size([Math.PI, radius]);
				layout(tree);
				// precompute radial coordinates
				tree.each(node => {
					// @ts-expect-error d3 adds x and y to the node
					const [x, y] = d3.pointRadial(node.x, node.y);
					// @ts-expect-error d3 adds x and y to the node
					node.x = x;
					// @ts-expect-error d3 adds x and y to the node
					node.y = y;
				});
				const bbox = treeBoundingBox(tree);
				monolithSubtrees.push({
					tree,
					bbox,
					x: 100,
					y: monolithYs,
				});
				const [_left, top, _right, bottom] = bbox;
				const height = bottom - top;
				monolithYs += height + subtreePadding;
			}

			const built: Region = {
				name: region.name,
				balancerSubtrees,
				monolithSubtrees,
				bbox: expandBBox(
					superBoundingBox([
						...balancerSubtrees.map(t => offsetBBox(t.bbox, t.x, t.y)),
						...monolithSubtrees.map(t => offsetBBox(t.bbox, t.x, t.y)),
					]),
					200
				),
			};
			return built;
		}

		function renderRegion(region: Region) {
			const monolithSubtrees = region.monolithSubtrees;
			const balancerSubtrees = region.balancerSubtrees;

			if (DEBUG_BOUNDING_BOXES) {
				svg.select(".monolith-trees")
					.selectAll("rect")
					.data([...monolithSubtrees, ...balancerSubtrees])
					.join("rect")
					.attr("x", d => d.x + d.bbox[0])
					.attr("y", d => d.y + d.bbox[1])
					.attr("width", d => d.bbox[2] - d.bbox[0])
					.attr("height", d => d.bbox[3] - d.bbox[1])
					.attr("fill", "rgba(255, 255, 255, 0.1)")
					.attr("stroke", "white")
					.attr("stroke-width", 1);
			}

			renderTrees(balancerSubtrees, ".balancer-trees");
			renderTrees(monolithSubtrees, ".monolith-trees");
		}

		const monolithBuiltRegions = new Map<string, Region>();
		for (const [name, region] of monolithRegions.entries()) {
			monolithBuiltRegions.set(name, buildRegion(region));
			renderRegion(monolithBuiltRegions.get(name)!);
		}

		svg.select(".regions")
			.selectAll(".region")
			.data(monolithBuiltRegions.values())
			.join("rect")
			.attr("class", "region")
			.attr("data-nodeid", d => d.name)
			.attr("x", d => d.bbox[0])
			.attr("y", d => d.bbox[1])
			.attr("width", d => d.bbox[2] - d.bbox[0])
			.attr("height", d => d.bbox[3] - d.bbox[1]);
	}, [
		svgRef,
		monolithTrees,
		balancerTrees,
		subtreePadding,
		colors,
		baseNodeRadius,
		clientNodeRadius,
		getRadius,
	]);

	useD3Zoom(svgRef);

	return (
		<svg
			viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`}
			width={width}
			height={height}
			ref={svgRef}
		>
			<g className="chart">
				<g className="regions"></g>
				<g className="balancer-trees"></g>
				<g className="monolith-trees"></g>
			</g>
		</svg>
	);
};