/*
Phylogenetic tree rendering library for Wasabi webapp (http://wasabiapp.org)
Based on jsPhyloSVG (Samuel Smits| GPL | http://jsphylosvg.com) and JStree (Heng Li | MIT | http://lh3lh3.users.sourceforge.net/jstree.shtml)
Copyright Andres Veidenberg (andres.veidenberg{at}helsinki.fi), University of Helsinki (2017)
Distributed under AGPL license (http://www.gnu.org/licenses/agpl)
*/

Smits = {
	/// Global functions accessible by all data objects ///
	Common: {
		nodeIdIncrement: 0,
		activeNode: 0,
		//Round float to a defined number of decimal places
		roundFloat: function(num, digits){
			if(!digits) digits = 4;
			var result = Math.round(num * Math.pow(10,digits))/Math.pow(10,digits);
			return isNaN(result)? 0 : result; 
		},
		//Add mouse event listener to SVG element
		addRaphEventHandler: function(el, eventType, fn, paramsObj){
			try{
				el[eventType](function(fn, paramsObj){
					return function(e,o){
						var params = paramsObj;
						params.e = e;
						fn(params);
					};
				}(fn, paramsObj));
			} catch (err){ console.log('Failed to add SVG event handler '+eventType); }	
		},
		//Process nodetree lengths & levels, add metadata. Used (rescoped) in fileparsing classes.
		processNodes: function(tree){
			var node = tree || this.root || ''; //'this' will be a data object from ...Parse()
			if(!node) return;
			for(var i in node.children){
				var child = node.children[i];
				if(model.dendogram()) child.len = 1;
				child.lenFromRoot = Smits.Common.roundFloat(node.lenFromRoot+child.len); //node total length from root
				child.level = node.level+1;
				if(child.level > this.maxLevel) this.maxLevel = child.level; //record max values
				if(child.lenFromRoot > this.maxLenFromRoot) this.maxLenFromRoot = child.lenFromRoot;
				if(child.children.length) this.processNodes(child);
				else if(this.nodeinfo && this.nodeinfo[child.name]){ //add external metadata
					$.each(this.nodeinfo[child.name],function(k,v){ child[k] = v; });
				}				
			}
			return node;
		}
  }//Smits.Common
};

/// Master data object. Contains tree data, SVG canvas and rendered tree objects. ///
Smits.PhyloCanvas = function(inputData){
	
	this.scale = function(multiplier){
		this.svg.svg1.scale(multiplier);
	};
	this.getSvgSource = function(){
		if(Raphael.svg && typeof(XMLSerializer)=='function'){
			var serialize = new XMLSerializer();
			return serialize.serializeToString(this.svg.svg1.canvas);
		} else { return false; }
	};
	this.refresh = function(options){ //re-render tree canvas
		if(!options) options = {};
		if(!this.svg) this.svg = new Smits.PhyloCanvas.Render.SVG();
		//build tree to the canvas
		this.phylogram = new Smits.PhyloCanvas.Render.Phylogram(this.svg, this.data);
		model.leafcount(this.data.root.visibleLeafCount); model.nodecount(this.data.root.nodeCount);
		if(!options.treeonly) redraw(options);
	}
	this.loaddata = function(dataobj){ //turn data file to object-tree
		Smits.Common.nodeIdIncrement = 0;
		if(typeof(dataobj)!='object') dataobj = {newick: dataobj};
		if(typeof(dataobj.sequences)!='object') dataobj.sequences = window.sequences;
		if(typeof(dataobj.idnames)!='object') dataobj.idnames = {};
		if(dataobj.phyloxml) this.data = new Smits.PhyloCanvas.PhyloxmlParse(dataobj);
		else if(dataobj.newick) this.data = new Smits.PhyloCanvas.NewickParse(dataobj);
		else dialog('error','No data given for tree import.');
		if(!dataobj.skiprender) this.refresh(dataobj);
	}
	
	this.loaddata(inputData);
};

/// Node Class. Allows tree data objects to be traversed across children ///
Smits.PhyloCanvas.Node = function(parentNode){
	//initiate node object
	this.id = ++Smits.Common.nodeIdIncrement;
	this.level = parentNode? parentNode.level+1: 0;
	this.nwlevel = 0;
	this.len = 0;
	this.lenFromRoot = 0;
	this.name = '';
	this.active = false;
	this.type = '';
	this.hidden = false;
	this.canvx = 0;
	this.canvy = 0;
	this.miny = 0;
	this.maxy = 0;
	this.children = [];
	this.parent = parentNode || false;
	this.nodeinfo = {};
	this.nhx = {};
	this.meta = {};

	//Calculations cache
	this.leafCount = 0;
	this.nodeCount = 0;
	this.visibleLeafCount = 0;
	this.visibleChildCount = 0;
	this.midBranchPosition = 0;
};

/// Functions for every node instance ///
Smits.PhyloCanvas.Node.prototype = {
	getById: function(id){
		if(this.id == id) return this;
		for(var i in this.children){
			var node = this.children[i].getById(id);
			if(node) return node;
		}
	},
	
	countChildren: function(hiddenbranch){
		this.leafCount = 0; this.visibleLeafCount = 0; this.visibleChildCount = 0;
		this.nodeCount = this.children.length? 1: 0;
		for(var i in this.children){
			var child = this.children[i];
			if(!child.hidden) this.visibleChildCount++;
			if(child.children.length){
				child.countChildren(hiddenbranch||child.hidden);
				this.nodeCount += child.nodeCount;
				this.leafCount += child.leafCount;
				if(!hiddenbranch) this.visibleLeafCount += child.visibleLeafCount;
			}
			else{
				if(child.hidden){ if(child.type!='ancestral') this.leafCount++; } 
				else{ this.leafCount++; if(!hiddenbranch) this.visibleLeafCount++; }
				child.edgeCircle = false;
			}
		}
	},
	
	getVisibleParentBranch: function(){
		if(this.parent.visibleChildCount > 1){ return this; }
		else{ return this.parent.getVisibleParentBranch(); }
	},
	
	hideToggle: function(action){ //hide/show a node
		if(!this.parent) return;
		var ishidden = action ? action=='hide' ? false: true: this.hidden;
		if(!ishidden){
			if(this.parent.visibleChildCount<2){ //if only 1 visible child
				this.getVisibleParentBranch().hidden = true;
			}
			else{ this.hidden = true; }
		}
		else{ this.hidden = false; }
		this.getRoot().countChildren(); //recount hidden/visible nodes
	},
	
	showSubtree: function(ancestral,hide){ //show all descendants or show/hide all ancestral leaves
		for (var i in this.children) {
			var child = this.children[i];
			if(child.children && child.children.length) child.showSubtree(ancestral,hide);
			else if((ancestral && child.type=='ancestral')||(!ancestral && child.type!='ancestral')){
				child.hidden = hide? true: false;
			}			
		}
		this.hidden = false;
		this.getRoot().countChildren();
	},
	
	getMidbranchPosition: function(firstBranch){
		this.midBranchPosition = firstBranch ? this.children[0].visibleLeafCount-0.5: this.children[0].visibleLeafCount+0.5;
		if(this.children[0].visibleLeafCount==0){ this.midBranchPosition += 1; }
		if(this.children[1] && this.children[1].type=='ancestral' && !this.children[1].hidden){ 
			this.midBranchPosition += 0.5; 
			if((this.children[0].hidden && !this.children[2].hidden)||this.visibleChildCount==1){ this.midBranchPosition -= 1; }
		} else if(this.visibleChildCount==1){ this.midBranchPosition -= 0.5; }
		return this.midBranchPosition;
	},
	
	highlight: function(mark){
		var node = this;
		node.active = typeof(mark)!='undefined'? mark: !node.active;
		if(node.active){ var fill='orange', op=1, txtfill='orange'; } else { var fill='red', op=0, txtfill=''; }
		if(node.type=='stem') node.svgEl.attr({'fill':fill,'fill-opacity':op});
		else{ node.svgEl.attr({'fill':'black'}); $(node.svgEl.node.firstChild).attr('fill',txtfill); }
	},
	
	removeAnc: function(){ //strip all ancestral seq. leaves
		var childarr = this.children, anci;
		for(var i in childarr){
			if(childarr[i].children.length) childarr[i].removeAnc(); 
			else if(childarr[i].type=='ancestral'){
				if(!childarr[i].hidden) this.showanc = true;
				anci = i;
			}
		}
		if(anci) childarr.splice(anci,1);
		return this;
	},
	
	restoreAnc: function(){ //insert leaves (sequences) for ancestral nodes
		var node = this;
		for(var i in node.children){ if(node.children[i].children.length) node.children[i].restoreAnc(); }
		if(node.children.length > 1 && node.children[1].type != 'ancestral' && node.name && sequences[node.name]){
			var firstchild = node.children.shift();
			var ancnode = new Smits.PhyloCanvas.Node(node);
			ancnode.lenFromRoot = node.lenFromRoot;
			ancnode.type = 'ancestral';
			ancnode.name = node.name;
			if(node.showanc){ ancnode.hidden = false; delete node.showanc; }
			else ancnode.hidden = true;
			node.children.unshift(firstchild,ancnode);
		}
	},
	
	nodeArray: function(){ //returns flattened array of nested nodetree
		var node = this.removeAnc(), nodearr = [], stack = [];
		stack.push({node:node, i:0});
		for(;;){
			while(stack[stack.length-1].i != stack[stack.length-1].node.children.length){
				var lastobj = stack[stack.length-1];
				stack.push({node:lastobj.node.children[lastobj.i], i:0});
			}
			nodearr.push(stack.pop().node);
			if(stack.length) stack[stack.length-1].i++;
			else break;
		}
		this.restoreAnc();
		return nodearr;
	},
	
	getRoot: function(flag){
		var node = this;
		var root = treesvg.data.root;
		if(flag && node!=root){
			while(node.parent){ node = node.parent; node.altered = true; }
			model.treealtered(true);
		}
		return root;
	},
	
	setRoot: function(new_root,norealign){
		new_root.parent.children = []; new_root.parent = false; new_root.id = 1;
		if(!new_root.name) new_root.name = 'Root';
		new_root.len = 0; new_root.level = 1; new_root.lenFromRoot = 0;
		if(!norealign){
			new_root.altered = true; //mark tree for realignment
			if(!model.treealtered()) model.treealtered(true);
		}
		new_root.countChildren(); //update children count
		treesvg.data.root = new_root;
		treesvg.data.maxLevel = treesvg.data.maxLenFromRoot = 0;
		treesvg.data.processNodes(); //update levels/lengths
		return treesvg.data.root;
	},
	
	reRoot: function(dist){ //place node as tree outgroup
		var i, plen, nodelen, pnode, newnode, gpnode, ggpnode, new_root;
		var node = this, root = node.getRoot().removeAnc();
		if(node.type == 'ancestral') node = node.parent;
		if(node == root) return root;
		if(isNaN(dist) || dist<0 || dist>node.len) dist = node.len/2.0;
		nodelen = node.len;
		node.getRoot('flag');
		
	  	//construct new root node
		newnode = new_root = new Smits.PhyloCanvas.Node();
		newnode.children[0] = node;
		newnode.children[0].len = dist;
		pnode = node.parent;
		newnode.children[0].parent = newnode;
		for(i = 0; i < pnode.children.length; ++i)
			if (pnode.children[i] == node) break;
		newnode.children[1] = pnode;
		plen = pnode.len;
		pnode.len = nodelen - dist;
		gpnode = pnode.parent;
		pnode.parent = newnode;
		while(gpnode){ //travel down to current root (gather subtrees)
			ggpnode = gpnode.parent;
			pnode.children[i] = gpnode;
			for (i = 0; i < gpnode.children.length; ++i) //i=current travelbranch
				if (gpnode.children[i] == pnode) break;
			gpnode.parent = pnode;
			nodelen = gpnode.len; gpnode.len = plen; plen = nodelen;
			newnode = pnode; pnode = gpnode; gpnode = ggpnode; //go up one level
		}
		if(pnode.children.length == 2){ //remove old root from its branch and link the other branch
			var otherchild = pnode.children[1 - i];
			for (i = 0; i < newnode.children.length; i++) // i=branch of current root
				if (newnode.children[i] == pnode) break;
			otherchild.len += pnode.len||0;
			otherchild.parent = newnode;
			newnode.children[i] = otherchild; //link the child from root-detached branch
		} else { //multifurcating node. Just remove old root.
			pnode.children.splice(i,1);
		}
		node.setRoot(new_root);
		model.addundo({name:'Reroot',type:'tree',data:node.getRoot().write('undo'),info:'Tree rerooted.'});
	},
	
	ladderize: function(skipundo){
		if(!this.children.length) return;
		var node = this;
		if(node.children[0].visibleLeafCount<node.children[node.children.length-1].visibleLeafCount) node.swap('skipundo');
		for(var i in node.children){
			if(node.children[i].visibleLeafCount>2) node.children[i].ladderize('skipundo');
		}
		if(!skipundo) model.addundo({name:'Ladderise',type:'tree',data:this.getRoot().write('undo'),info:'The subtree of \''+node.name+'\' was reordered.'});
	},
	
	swap: function(skipundo){ //swap children
		var swapnode = this.children[0];
		this.children[0] = this.children[this.children.length-1];
		this.children[this.children.length-1] = swapnode;
		if(!skipundo) model.addundo({name:'Swap nodes',type:'tree',data:this.getRoot().write('undo'),info:'Tree node \''+swapnode.name+'\' swapped places with its sibling.'});
	},
	
	//Move: prune the subtree descending from this node and regragh it to the edge between targetnode and its parent
	move: function(target){
		var root = this.getRoot().removeAnc();
		var node = this;
		if (node === root || node.parent === root) return false; //can't move root
		for (var r = target; r.parent; r = r.parent){
			if (r === node) return false; //moving node is an ancestor of target. Can't move.
		}
		if(target.parent === node.parent){ node.parent.swap(); return false; } //node is a sister of target. Swap siblings.
		else if(target === node.parent){ return false; } //moving to node's original place
		node.remove('skipundo');

		var placeholder = new Smits.PhyloCanvas.Node();
		placeholder.children.push(root); root.parent = placeholder;

		var i, pnode = target.parent;
		for (i in pnode.children){ if (pnode.children[i] === target) break; }
		var newnode = new Smits.PhyloCanvas.Node();
		newnode.parent = pnode; pnode.children[i] = newnode;
		pnode.altered = true;
		if (target.len > 0) {
			newnode.len = target.len/2;
			target.len /= 2;
		}
		newnode.children.push(node); node.parent = newnode;
		newnode.children.push(target); target.parent = newnode;
		node.setRoot(placeholder.children[0]);
		node.getRoot('mark');
		model.addundo({name:'Move node',type:'tree',data:node.getRoot().write('undo'),info:'Tree node \''+this.name+'\' was attached to node "'+target.name+'".'});
	},
	
	remove: function(skipundo,skipcount){ //remove node+descendants from tree
		var node = this, root = node.getRoot().removeAnc(), pnode = node.parent;
		if(node == root) return;
		if(pnode != root){
			node.getRoot('flag'); //flag path to root
			var placeholder = new Smits.PhyloCanvas.Node(); //attach root to temp. buffer node
			placeholder.children.push(root); root.parent = placeholder;
		}

		if (pnode.children.length == 2){
			var otherbranch, gpnode = pnode.parent;
			var i = (pnode.children[0] == node)? 0: 1;
			otherbranch = pnode.children[1 - i];
			if(pnode == root){ //special case - replace root
				if(otherbranch.children.length > 1) otherbranch.prune();
				return;
			} else { //connect the other branch with grandparent
				otherbranch.len = Smits.Common.roundFloat(otherbranch.len+pnode.len);
				otherbranch.parent = gpnode;
				for(i in gpnode.children) if(gpnode.children[i] == pnode) break;
				gpnode.children[i] = otherbranch;
			}
		} else { //multifurcating parent
			for(i in pnode.children) if (pnode.children[i] == node) break;
			pnode.children.splice(i,1);
		}
		
		//remove node+parent
		pnode.parent = false; pnode.children = []; node.parent = false; root.parent = false;
		if(!skipcount) root.countChildren();
		if(!skipundo){ //add undo, unless part of node move or batch remove
			delete leafnodes[node.name];
			model.nodecount(root.nodeCount); model.leafcount(root.leafCount);
			model.addundo({name:'Remove node',type:'tree',data:root.write('undo'),info:'Node \''+node.name+'\' was removed from the tree.'});
		}
	},
	
	prune: function(){ //keep node+subtree, remove the rest
		var node = this, nodename = node.name, root = node.getRoot().removeAnc();
		node.setRoot(node,'norealign');
		model.addundo({name:'Prune subtree',type:'tree',data:node.getRoot().write('undo'),info:'Subtree of node \''+nodename+'\' was pruned from main tree.'});
	},
	
	write: function(tags,noparents,nameids){ //convert nodetree to newick string
		if(tags=='undo' && !settingsmodel.undo()) return '';
		var nameids = nameids||{};
		var nodearr = this.nodeArray();
		//update levels
		nodearr[nodearr.length-1].nwlevel = 0;
		for (var i = nodearr.length-2; i>=0 ;i--) {
			var node = nodearr[i];
			node.nwlevel = node.parent.nwlevel+1;
		}
		//generate newick
		var str = name = '';
		var curlevel = 0, isfirst = true;
		for(var i in nodearr){
			var node = nodearr[i];
			var n_bra = node.nwlevel - curlevel;
			if (n_bra > 0) {
				if (isfirst) isfirst = false;
				else str += ",";
				for (var j = 0; j < n_bra; ++j) str += "(";
			} else if (n_bra < 0) str += ")";
			else str += ",";
			if(!noparents||node.type!='stem'){
				name = nameids[node.name]||node.name;
				str += tags=='undo'? '"'+name+'"': name.replace(/ /g,'_');
			}
			if(node.len >= 0 && node.nwlevel > 0) str += ":" + node.len;
			if(tags){ //write metadata
				var nhx = '';
				if(node.nhx) $.each(node.nhx, function(k,v){ nhx += ':'+k+'='+v; }); //imported nhx metainfo
				nhx += (node.hidden?':Co=Y':'')+(node.altered?':XN=realign':''); //update metainfo
				if(node.type=='stem' && node.children[1].type=='ancestral' && !node.children[1].hidden) nhx += ':Vis=Y';
				$.each(Smits.PhyloCanvas.NewickMeta, function(tag,title){ if(node.nodeinfo[title]) nhx += ':'+tag+'='+node.nodeinfo[title]; });
				if(nhx) str += '[&&NHX'+nhx.replace(/[\s\(\)\[\]&;,]/g,'_')+']';
			}
			curlevel = node.nwlevel;
		}
		str += ";\n";
		return str;
	},
	
	calcxy: function(){ //calculate coords for tree preview canvas
		var i,j;
		var nodearr = this.nodeArray();
		var scale = this.leafCount-1; //nr. of all leafs
		for(i = j = 0; i < nodearr.length; i++){ //calculate y
			var node = nodearr[i];
			node.canvy = node.children.length? (node.children[0].canvy + node.children[node.children.length-1].canvy)/2: (j++)/scale;
			if (node.children.length == 0) node.miny = node.maxy = node.canvy;
			else node.miny = node.children[0].miny, node.maxy = node.children[node.children.length-1].maxy;
		}
		// calculate x
		nodearr[nodearr.length-1].canvx = 0;
		scale = 0;
		for(i = nodearr.length-2; i >= 0; i--){
			var node = nodearr[i];
			node.canvx = node.parent.canvx + node.len;
			if(node.canvx > scale) scale = node.canvx;
		}
		for (i = 0; i < nodearr.length; i++) nodearr[i].canvx /= scale;
		return nodearr;
	},
	
	makeCanvas: function(){ //draw tree preview canvas
		var nodearr = this.calcxy();
		var conf = {width:100,height:150,xmargin:4,ymargin:2,fontsize:5,c_line:"rgb(60,60,60)"};
		if(nodearr.length<10) conf.width = conf.height = 8*nodearr.length;
		var canvas = document.createElement('canvas');
		canvas.width = conf.width; canvas.height = conf.height;
		var ctx = canvas.getContext("2d");
		ctx.strokeStyle = ctx.fillStyle = "white";
		ctx.fillRect(0, 0, conf.width, conf.height);
	
		var real_x = conf.width-2 * conf.xmargin;
		var real_y = conf.height-2 * conf.ymargin - conf.fontsize;
		var shift_x = conf.xmargin;
		var shift_y = conf.ymargin + conf.fontsize/2;
	
		// horizontal lines
		var y;
		ctx.strokeStyle = conf.c_line;
		ctx.beginPath();
		y = nodearr[nodearr.length-1].canvy * real_y + shift_y;
		ctx.moveTo(shift_x, y); ctx.lineTo(nodearr[nodearr.length-1].canvx * real_x + shift_x, y);
		for (var i = 0; i < nodearr.length - 1; i++) {
			var node = nodearr[i];
			y = node.canvy * real_y + shift_y;
			ctx.moveTo(node.parent.canvx * real_x + shift_x, y);
			ctx.lineTo(node.canvx * real_x + shift_x, y);
		}
		// vertical lines
		var x;
		for (var i = 0; i < nodearr.length; i++) {
			var node = nodearr[i];
			if (node.children.length == 0) continue;
			x = node.canvx * real_x + shift_x;
			ctx.moveTo(x, node.children[0].canvy * real_y + shift_y);
			ctx.lineTo(x, node.children[node.children.length-1].canvy * real_y + shift_y);
		}
		ctx.stroke();
		ctx.closePath();
		canvas.style.borderRadius = '2px';
		return canvas;
	}	
};//<--Node.prototype functions

//tag:name dictionary for displaying nhx metadata
Smits.PhyloCanvas.NewickMeta = {'S':'species', 'B':'bootstrap', 'T':'taxon_id', 'AC':'accession', 'E':'ec', 'GN':'gene', 'ND':'id', 'N':'id', 'G':'gene_id', 'TR':'transcript_id', 'PR':'protein_id', 'PVAL':'p_value'};
/// Parse (extended) Newick formatted text to a tree data object ///
Smits.PhyloCanvas.NewickParse = function(data){
	var text = data.newick, ch = '', pos = 0, treealtered = false;
	var mdict = Smits.PhyloCanvas.NewickMeta;
			
	var object = function (parentNode,node){  //fill node with data
		if(!node) node = new Smits.PhyloCanvas.Node(parentNode);
		while (ch && ch!==')' && ch!==','){
			if (ch === '['){ //read metadata
				var meta = quotedString(']');
				meta = meta.split(':');
				$.each(meta, function(i,pair){ //parse metadata
					var k = pair.split('=');
					if(!k[1]) return true;
					else if(k[0]=='Co' && k[1]=='Y') node.hidden = true;
					else if(k[0]=='Vis' && k[1]=='Y') node.showanc = true;
					else if(k[0]=='SEL' && k[1]=='Y') node.selection = true;
					else if(k[0]=='XN' && k[1]=='realign'){ node.altered = true; treealtered = true; }
					else if(k[0]=='C' || k[0]=='BC'){ //node or branch color
						var clr = k[1].replace(/\./g, ',');
						var clrn = (k[0]+'olor').toLowerCase();
						node[clrn] = ~clr.indexOf(',')?'rgb('+clr+')':clr;
					}
					else if(k[0]=='NL') node.nodelabel = mdict[k[1]]||''; //custom node label
					else if(k[0]=='CR') node.csize = parseInt(k[1]); //node circle radius (px)
					else if(k[0]=='Ev'){
						var ev = k[1].split('>');
						node.nodeinfo.duplications = parseInt(ev[1]);
						node.nodeinfo.speciations = parseInt(ev[2]);
					} 
					else if(k[0]=='D') node.nodeinfo[(['Y','T','N','F'].indexOf(k[1])<2?'duplications':'speciations')] = 1;
					else if(mdict[k[0]]){ //use metadata dictionary
						if(k[0]=='S') k[1] = k[1].capitalize().replace(/_/g, ' ');
						node.nodeinfo[mdict[k[0]]] = k[1];
						if(k[0]=='S' || k[0]=='B') node[mdict[k[0]]] = k[1];
					}
					node.nhx[k[0]] = k[1];
				});
			} else if (ch===':'){ //read branchlength
				nextChar();
				node.len = Smits.Common.roundFloat(string(), 4);
			} else if (ch==="'" || ch==='"') node.name = quotedString(ch); //read name
			else node.name = string();
		}
		if(node.name){
			if(data.idnames[node.name]) node.name = data.idnames[node.name];
			node.name = node.name.trim().replace(/_/g,' ');
		}
		if(node.children.length) node.type = 'stem';
		else node.type = 'label';
		return node;
	},
	
	objectIterate = function(parentNode){ //make stem nodes
		while(ch && ch!=='(') nextChar(); //search for first '('
		var node = new Smits.PhyloCanvas.Node(parentNode);
		while(ch && ch!==')'){ //build node tree
			nextChar();
			if( ch==='(' ) { node.children.push(objectIterate(node)); } //go deeper 
			else { node.children.push(object(node)); } //add leaf
		}
		nextChar(); //one subtree made [found ')'] 
		object(parentNode,node); //add data to node
		return node;		
	},
	
	string = function(){
		var string = '';
		while (ch && ch!==':' && ch!==')' && ch!==',' && ch!=='['){
			string += ch;
			nextChar();
		}
		return string;
	},

	quotedString = function(quoteEnd){
		var string = '';
		nextChar();
		while (ch && ch !== quoteEnd){
			string += ch;
			nextChar();
		}
		nextChar();
		return string;
	},	
	
	nextChar = function(){
		ch = text.charAt(pos);
		if(ch===';') ch = '';
		pos++;
		return ch;
	};

	this.processNodes = Smits.Common.processNodes;
	//initiate
	this.maxLevel = 0;
	this.maxLenFromRoot = 0;
	nextChar();
	this.root = objectIterate(); //read text to nodetree
	this.treealtered = treealtered;
	this.root.len = 0;
	this.root.countChildren();
	//model.leafcount(this.root.leafCount); model.nodecount(this.root.nodeCount);
	this.nodeinfo = data.nodeinfo || {};
	this.processNodes(); //process nodetree
};  //<--NewickParse

/// Parse PhyloXML text format to a tree data object ///
Smits.PhyloCanvas.PhyloxmlParse = function(data){
	var recursiveParse = function(clade, parentNode){
		var node = new Smits.PhyloCanvas.Node(parentNode);
		
		clade.children('clade').each(function(){ node.children.push(recursiveParse($(this), node)); });
		
		//node xml: clade->taxonomy(->id;sci_name)
		//leaf xml: clade->name(=geneid);taxonomy(->id;sci_name);sequence(->accession(=proteinid);name(=genename);location;mol_seq)
		
		var nodelen = clade.attr('branch_length')||clade.children('branch_length').text()||0;
		node.len = Smits.Common.roundFloat(nodelen, 4);
		
		if(clade.children('name').length) node.name = node.nodeinfo.gene_id = clade.children('name').text(); //Ensembl gene ID
		
		clade.children('confidence').each(function(){ //confidence scores
			node.nodeinfo[$(this).attr('type')] = parseFloat($(this).text()); //bootstrap || duplication_confidence_score
		});
		if(clade.attr('color')) node.color = clade.attr('color');
		else if(clade.children('color').length){
			var rgb = clade.children('color');
			node.color = 'rgb('+rgb.children('red').text()+','+rgb.children('green').text()+','+rgb.children('blue').text()+')';
		}
		var taxonomy = clade.children('taxonomy'); //species name & id
		if(taxonomy.length){
			if(taxonomy.children('scientific_name').length) node.nodeinfo.scientific_name = taxonomy.children('scientific_name').text();
			node.species = taxonomy.children('common_name').text() || node.nodeinfo.scientific_name || '';
			node.species = node.nodeinfo.species = node.species.replace(/_/g,' ');
			node.nodeinfo.taxon_id = taxonomy.children('id').text();
			//if(node.nodeinfo.taxon_id) node.meta.taxon_id_provider = taxonomy.children('id').attr('provider')||'';
		}
		
		var cladeseq = clade.children('sequence');
		if(cladeseq.length){ //leaf
			node.nodeinfo.gene = cladeseq.children('name').text(); //gene name
			if(cladeseq.children('mol_seq').length && node.name){
				data.sequences[node.name] = cladeseq.children('mol_seq').text().split('');
			}
			node.nodeinfo.accession = cladeseq.children('accession').text(); //protein id
			//node.meta.accession_source = cladeseq.children('accession').attr('source')||'';
		}
		
		if(!node.name) node.name = node.species || (node.children.length? 'Node '+node.id: 'Sequence '+node.id);
		node.name = node.name.trim(node.name);
		
		var eventinfo = clade.children('events');
		if(eventinfo.length){ //ensembl info for duplication/speciation node
			node.nodeinfo.duplications = eventinfo.children('duplications').text();
			node.nodeinfo.speciations = eventinfo.children('speciations').text();
		}
		
		if(node.children.length) node.type = 'stem';
		else node.type = 'label';
		
		return node;
	};
	
	this.processNodes = Smits.Common.processNodes;
	this.maxLevel = 0;
	this.maxLenFromRoot = 0;
	//initiate	
	xmldata = $($.parseXML(data.phyloxml)).find('phylogeny>clade'); //get root clade (jQuery) object
	if(xmldata.length){
		this.root = recursiveParse(xmldata);
		this.root.len = 0;
		this.root.countChildren();
		//model.leafcount(this.root.leafCount); model.nodecount(this.root.nodeCount);
		this.nodeinfo = data.nodeinfo || {};
		this.processNodes(); //process nodetree
	}
};  //<--PhyloxmlParse

Smits.PhyloCanvas.Render = {
	Style: { //Default SVG element styles
		text: {
			"fill": 'black',
			"font-family":	'Verdana',
			"text-anchor":	'start'
		},
		
		path: {
			"stroke": 'rgb(0,0,0)',
			"stroke-width":	1	
		},
		
		connectedDash: {"stroke-dasharray": '1,4'},
		
		edgeCircle: {
			"stroke": 'red',
			"fill": 'none'
		},
		
		nodeCircle: {
			"fill": 'black',
			"stroke": 'black'
		}
  },
  
  Parameters: { // Style & mouse event parameters for tree SVG elements
	Rectangular: {
		paddingL: 5, 		//Padding on tree right side
		paddingR: 5,		//Padding on tree left side
		paddingNames: 2, 		//label left side padding, pixels
		minRowHeight: 3,  	// Should be set low, to avoid clipping when implemented
		dotLine: true,
		showScaleBar: false		// (STRING,  e.g. "0.05") Shows a scale bar on tree canvas
	},
	
	/*  Rollover Events. Params: {svg,node,x,y,textEl} */
	mouseRollOver: function(params) {
		var node = params.node;
		if(node.edgeCircle){ if(!node.active) node.edgeCircle.show(); }
		else{
			var edgecattr = $.extend({}, Smits.PhyloCanvas.Render.Style.edgeCircle);
			var circleObject = params.svg.draw(new Smits.PhyloCanvas.Render.Circle(params.x, params.y, 5, edgecattr));
			node.edgeCircle = circleObject;
		}					
		if(params.textEl){ //hover on leaf label
		  if(!node.active) params.textEl.setAttribute('fill','red');
		  var rowh = model.boxh();
		  var topadj = Boolean(window.webkitRequestAnimationFrame)? -1: 0;//webkit offset adjustment
		  var topy = Math.round($(params.textEl).offset().top);
		  var seqy = ((topy-$('#seq').offset().top)/rowh)*rowh; //snap to rowgrid
		  rowborder({y:seqy+topadj},'keep'); //highlight seq row
		  node.rolltimer = setTimeout(function(){ //show full name on mouse hover
			var namelabel = $("#namelabel"), namelabelspan = $("#namelabel span");
		  	namelabelspan.text(params.textEl.textContent);
		  	namelabel.css({'font-size': model.fontsize()+'px', 'display':'block', 'opacity':0});
			namelabel.offset({left:$("#right").offset().left-16, top:topy-1+topadj});
			namelabelspan.css('margin-left',0-$("#names").innerWidth()+6+'px');
			if(topy){ namelabel.fadeTo(100,1); }
		  },300);
		}
	},
	
	mouseRollOut: function(params){
		if(params.node.edgeCircle) params.node.edgeCircle.hide();
		if(params.textEl){ //mouse out from leaf label
			clearTimeout(params.node.rolltimer);
			$("#namelabel").fadeOut(100);
			if(!params.node.active) params.textEl.setAttribute('fill', params.node.color);
		}
	},
	
	onClickAction: function(params){
		if(params.node.edgeCircle) params.node.edgeCircle.hide();		
		if(params.textEl){ //click on leaf label => popup menu
			if(toolsmodel.prunemode){ params.node.highlight(); return; } //toggle highlight
			params.textEl.setAttribute('fill','red');
			var node = params.node;
			node.active = true;
			var menudata = {};
			var infomenu = {' ':''};
			var infotitle = 'Metadata';
			var usedmeta = [];
			infomenu['<span class="note">Branch length</span> '+(Math.round(node.len*1000)/1000)] = '';
			if(!$.isEmptyObject(model.ensinfo()) && node.species){ //submenu for leaf metadata
				infotitle = 'Ensembl';
				infomenu['<span class="note">Species</span> '+node.species] = '';
				if(node.nodeinfo.gene_id){
					infomenu['<span class="note">Gene</span> '+
					'<a href="http://www.ensemblgenomes.org/id-gene/'+node.nodeinfo.gene_id+
					'" target="_blank" title="View in Ensembl">'+(node.nodeinfo.gene||node.nodeinfo.gene_id)+'</a>'] = '';
				}
				if(node.nodeinfo.accession){
					var ispr = /ENS\w+P\d+/.test(node.nodeinfo.accession); //accession could be protein or transcript ID
					var istr = /ENS\w+T\d+/.test(node.nodeinfo.accession);
					infomenu['<span class="note">'+(ispr?'Protein':istr?'Transcript':'Accession')+'</span> '+
					'<a href="http://www.ensemblgenomes.org/id/'+node.nodeinfo.accession+
					'" target="_blank" title="View in Ensembl">'+node.nodeinfo.accession+'</a>'] = '';
				}
    			usedmeta = ['scientific_name','id','species','gene','accession'];
    		}
			$.each(node.nodeinfo, function(title,val){ //display all metadata
				if(!~usedmeta[title]) infomenu['<span class="note">'+title.capitalize().replace('_',' ')+'</span> '+val] = ''; 
			});
    		menudata['<span class="svgicon" title="View metadata">'+svgicon('info')+'</span>'+infotitle] = {submenu:infomenu};
			menudata['<span class="svgicon" title="Hide node and its sequence">'+svgicon('hide')+'</span>Hide leaf'] = function(){ node.hideToggle(); refresh(); };
			menudata['<span class="svgicon" title="Graft this node to another branch in the tree">'+svgicon('move')+'</span>Move leaf'] = function(){ setTimeout(function(){ node.highlight(true) },50); movenode('',node,'tspan'); };
    		menudata['<span class="svgicon" title="Place this node as the tree outgroup">'+svgicon('root')+'</span>Place root here'] = function(){ node.reRoot(); refresh(); };
    		menudata['<span class="svgicon" title="Remove this node from the tree">'+svgicon('trash')+'</span>Remove leaf'] = function(){ node.remove(); refresh(); };
    		setTimeout(function(){ tooltip('','',{clear:true, arrow:'top', data:menudata, style:'none', nodeid:node.id, style:"leafmenu",
    		target:{ x:$("#names").offset().left, y:$(params.textEl).offset().top, height:model.boxh(), width:$("#names").width() }}) },100);
    	}
	}
  }//Render.Parameters
}; //<--obj Render

Smits.PhyloCanvas.Render.Line = function(x1, y1, x2, y2, attr){
	this.type = 'line';
	this.x1 = x1;
	this.x2 = x2;
	this.y1 = y1;
	this.y2 = y2;
	if(attr) this.attr = attr;
};
Smits.PhyloCanvas.Render.Text = function(x, y, text, attr){
	this.type = 'text';
	this.attr = $.extend({}, Smits.PhyloCanvas.Render.Style.text);
	this.x = x;
	this.y = y;
	this.text = text;
	if(attr) $.extend(this.attr, attr);
};
Smits.PhyloCanvas.Render.Path = function(path, attr){
	this.type = 'path';
	this.attr = $.extend({}, Smits.PhyloCanvas.Render.Style.path);
	this.path = path;
	if(attr) $.extend(this.attr, attr);
};
Smits.PhyloCanvas.Render.Circle = function(x, y, radius, attr){
	this.type = 'circle';
	this.attr = $.extend({}, Smits.PhyloCanvas.Render.Style.nodeCircle);
	this.x = x;
	this.y = y;
	this.radius = radius;
	if(attr) $.extend(this.attr, attr);
};

//create SVG canvas elements on first tree render
Smits.PhyloCanvas.Render.SVG = function(){
	this.canvasSize = [200,200]; //will be updated in render.phylogram()
	this.svg1 = Raphael('tree', "100%", "100%"); //#tree > tree SVG
	this.svg2 = Raphael('names', "100%", "100%"); //#names > names SVG
	$(this.svg2.canvas).css('font-size',model.fontsize()+'px');
	this.percX = function(num){ return (num/this.canvasSize[0]*100).toFixed(2)+'%'; }; //convert all coordinates from px to %
	this.percY = function(num){ return (num/this.canvasSize[1]*100).toFixed(2)+'%'; };
};

Smits.PhyloCanvas.Render.SVG.prototype = {
	//Functions for svg object (has multiple svgs)
	draw: function(instruct){
		var obj = {};
		if(instruct.type == 'line') obj = this.svg1.line(this.percX(instruct.x1), this.percY(instruct.y1), this.percX(instruct.x2), this.percY(instruct.y2));
		else if(instruct.type == 'path') obj = this.svg1.path(instruct.path);			
		else if(instruct.type == 'circle') obj = this.svg1.circle(this.percX(instruct.x), this.percY(instruct.y), instruct.radius).attr(instruct.attr);
		else if(instruct.type == 'text'){
			if(instruct.attr && instruct.attr.svg == 'svg1') obj = this.svg1.text(this.percX(instruct.x), this.percY(instruct.y), instruct.text);
			else obj = this.svg2.text(instruct.x, this.percY(instruct.y), instruct.text);
		}
		if(instruct.attr){
			obj.attr(instruct.attr);
			if(obj.attr.style) obj[0].setAttribute("style", obj.attr.style);
		}
		return obj;
	}
};

/// Draw a new tree. Input: tree data object + svg canvas ///
Smits.PhyloCanvas.Render.Phylogram = function(svg, data){
		
	var calculateNodePositions = function (node, positionX){
		//set baseline of current row
		if(!firstBranch && !node.visibleChildCount && !node.hidden) absoluteY = absoluteY + rowHeight;
		
		if(node.children.length){ //draw stemlines
			var nodeCoords = [], x1, x2, y;
			node.restoreAnc(); //add leave nodes for ancestral sequences
			
			if(node.hidden) return [];
			
			x1 = positionX; //in px
			x2 = positionX = positionX + (scaleX * node.len);
			if(x2-x1<2) x2 = positionX = x1+2; //min. px separating branch levels
			y = absoluteY + (node.getMidbranchPosition(firstBranch) * rowHeight);
			//horizontal line
			var lineattr = {class:'horizontal', title: "Branch length: "+node.len, nodeid: node.id};
			var stemline = svg.draw(new Smits.PhyloCanvas.Render.Line(x1, y, x2, y, lineattr));
			if(node.bcolor) stemline[0].setAttribute("style","stroke:"+node.bcolor);
			
			//traverse to children and draw vertical line
			if(node.visibleChildCount>0){
				for(var i = 0; i < node.children.length; i++){
					var child = node.children[i];
					if(child.hidden) continue;
					nodeCoords.push(calculateNodePositions(child, positionX));
				}
				nodeCoords.push(y);
			  	if(node.visibleLeafCount>1){ //get vertical bounds of children
			  		var verticalY1 = Math.min.apply(null, nodeCoords);
			  		var verticalY2 = Math.max.apply(null, nodeCoords);
			  		var vline = svg.draw(new Smits.PhyloCanvas.Render.Line(positionX, verticalY1, positionX, verticalY2));
			  		vline.toBack();
				}
			}
			
			//draw branching point
			var tipnote = '';
			var cradius = node.csize || settingsmodel.csize();
			var cattr =  {fill:'black', stroke:'black'};
			if(node.children[1].type=='ancestral') cattr.fill = 'white'; //has ancestral seq.
			var first = node.children[0].hidden;
			var last = node.children[node.children.length-1].hidden;
			if(first || last){ //has hidden branch(es)
				cattr.fill = 'white';
				var hastree = (first&&node.children[0].type!='label')||(last&&node.children[node.children.length-1].type!='label');
				if(first && last){ //anc. shown, both branches hidden
					cattr.stroke = 'orange';
					tipnote = 'Only node seq. shown';
				}else{ //one branch hidden
					tipnote = hastree? 'Subtree hidden': 'One leaf hidden';
				}
				if(hastree) cradius = 4; else cradius = 3;
			}
			if(node.altered){
				cattr.fill = 'red';
				tipnote = 'Needs realignment';
			}
			if(node.duplications){
				cattr.fill = 'lightblue'; cattr.stroke = 'blue';
				if(!tipnote) tipnote = 'Duplication node';
			}
			if(node.color) cattr.fill = cattr.stroke = node.color;
			var circle = svg.draw(new Smits.PhyloCanvas.Render.Circle((x2 || positionX), y, cradius, cattr));

			tipnote = $('#right').hasClass('dragmode')? '': (node.name.length>5?'<br>':' ')+'<span class="note">'+(tipnote||'Click or drag')+'</span>';
			var name = node.name || 'no name';
			circle.mouseover(function(e){
				if(!$('#treemenu .tooltipcontent').text()){ 
					circle.attr({'r': '5'});
					tooltip(e, name+tipnote, {target:'circle', id:"treemenu", arrow:'left', style:'black', nodeid:node.id, nohide:true});
				}
			});
			circle.mouseout(function(){ if(!$('#treemenu .tooltipcontent').text()) hidetooltip("#treemenu"); circle.attr({'r': cradius}); });
			circle.click(function(e){
				if(!$('#treemenu .tooltipcontent').text()){
					e.stopPropagation();
					tooltip(e, name, {clear:true, target:'circle', id:"treemenu", style:'black', data:{}, nodeid:node.id, nomove:true});
					e.stopPropagation();
				}
			});
			var nodelabel = node.nodeinfo[node.nodelabel||settingsmodel.nodelabel()] || '';
			if(nodelabel){ //draw label next to treenode
				var texth = parseInt(model.boxh()*0.7);
				svg.draw(new Smits.PhyloCanvas.Render.Text((x2 || positionX)+8, y+(texth/2)-2, nodelabel, {svg:"svg1", "font-size":svg.percY(texth)+'%'}));
			}
		} else { //draw leaflines and labels
			if(node.hidden){ if(node.type!='ancestral') leafnodes[node.name] = node; return []; }
			else leafnodes[node.name] = node;
			
			x1 = positionX;
			x2 = positionX + (scaleX * node.len);
			if(x2-x1<0.5) x2 = positionX = x1+0.5; //dot-length leaf branches
			if(x2 > xLim && x2 > overflowX) overflowX = x2; //tree drawing overflow
			y = absoluteY;			
				
			//horizontal endline
			var leaflineattr = {class:"horizontal", nodeid:node.id, title:"Branch length: "+node.len};
			var leafline = svg.draw(new Smits.PhyloCanvas.Render.Line(x1, y, x2, y, leaflineattr));
			if(node.bcolor) leafline[0].setAttribute("style","stroke:"+node.bcolor);
			
			if(sParams.dotLine && (xLim-x2>5)){ //dotline
				var dotattr = {class: "horizontal", nodeid: node.id};
				$.extend(dotattr, Smits.PhyloCanvas.Render.Style.connectedDash);
				var dotline = svg.draw(new Smits.PhyloCanvas.Render.Line( x2, y, xLim, y, dotattr));
				if(node.bcolor) dotline[0].setAttribute("style","stroke:"+node.bcolor);
			}
			
			if(node.name){
				visiblerows.push(node.name); //visible leaf==>order of drawing sequences
				var labely = y+(rowHeight*0.3);
				// leaf label
				var leafattr = node.style || {};
				leafattr.nodeid = node.id;
				if(node.color) leafattr.fill = node.color;
				if(node.description) leafattr.title = node.description;
				node.count = namecounter;
				var leafname = node.nodeinfo[node.nodelabel||settingsmodel.leaflabel()] || node.name;
				if(!$.isEmptyObject(model.ensinfo()) && node.species) leafname = node.species; //show species for Ens. genetrees
				var leaflabel = svg.draw(new Smits.PhyloCanvas.Render.Text(sParams.paddingNames, labely, leafname, leafattr));
				node.svgEl = leaflabel;
				
				// hover and click events for label element
				if(Smits.PhyloCanvas.Render.Parameters.mouseRollOver){
					Smits.Common.addRaphEventHandler(
						leaflabel, 
						'mouseover', 
						Smits.PhyloCanvas.Render.Parameters.mouseRollOver, 
						{ svg: svg, node: node, x: x2, y: y, textEl: leaflabel[0] }
					);
				}
				if(Smits.PhyloCanvas.Render.Parameters.mouseRollOut){
					Smits.Common.addRaphEventHandler(
						leaflabel, 
						'mouseout', 
						Smits.PhyloCanvas.Render.Parameters.mouseRollOut, 
						{ node: node, x: x2, y: y, textEl: leaflabel[0] }
					);				
				}
				if(Smits.PhyloCanvas.Render.Parameters.onClickAction){
					Smits.Common.addRaphEventHandler(
						leaflabel, 
						'click', 
						Smits.PhyloCanvas.Render.Parameters.onClickAction, 
						{ svg: svg, node: node, x: x2, y: y, textEl: leaflabel[0], data: data }
					);				
				}
			}
			
			namecounter++;
		}
		if(firstBranch) firstBranch = false;
		return y;
	};
	
	var drawScaleBar = function (){
		//y = absoluteY + rowHeight;
		y = 20;
		x1 = 10;
		x2 = x1 + (sParams.showScaleBar * scaleX);
		svg.draw(new Smits.PhyloCanvas.Render.Line(x1, y, x2, y));
		svg.draw(new Smits.PhyloCanvas.Render.Text((x1+x2)/2, y-8, sParams.showScaleBar));
	};
		
	//reset environment
	$('#treewrap').css('display','none'); //hide canvas while under construction
		
	var sParams = Smits.PhyloCanvas.Render.Parameters.Rectangular;
	var rowHeight = model.boxh(); //height of row
	if(rowHeight < sParams.minRowHeight) rowHeight = sParams.minRowHeight;
	var firstBranch, absoluteY, visiblerows, namecounter;
	
	var wipe = function(){
		svg.svg1.clear(); svg.svg2.clear();
		model.visiblerows.removeAll();
		firstBranch = true; absoluteY = rowHeight*0.6; namecounter = 0;
		visiblerows = []; leafnodes = {};
	}
	
	wipe();

		
	data.root.countChildren();
	seqcount = data.root.visibleLeafCount; //tree height estimation.
	if(!seqcount){
		dialog('error','Found no leafs to show when rendering the tree canvas.<br>Probably a data parsing error.');
		return;
	}
	
	var canvasWidth = $('#treewrap').width()-$('#names').width(); //update tree canvas dimensions
	var canvasHeight = seqcount*rowHeight;
	svg.canvasSize = [canvasWidth, canvasHeight];		
	var scaleX = (canvasWidth - sParams.paddingL - sParams.paddingR)/data.maxLenFromRoot;
	var xLim = canvasWidth - sParams.paddingR;

	var overflowX = 0;
	calculateNodePositions(data.root, sParams.paddingL); //build tree svg elements
	if(overflowX){
		scaleX = scaleX*((xLim-sParams.paddingL)/overflowX);
		wipe();
		calculateNodePositions(data.root, sParams.paddingL);
	}

	model.visiblerows(visiblerows);
	$('#treewrap').css('display','block');
	
	// Draw Scale Bar
	if(sParams.showScaleBar) drawScaleBar();
}; //<--Render.Phylogram